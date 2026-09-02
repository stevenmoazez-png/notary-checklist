import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { BriefSchema, BRIEF_SYSTEM } from "./brief-schema.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = Number(process.env.PORT) || 8080;

/* ---- limits -------------------------------------------------------------
   Deliberately tight. Escrow packages are a handful of pages, and a loose
   cap here is what turns an API key into someone else's free compute.      */
const MAX_BODY_BYTES = 14 * 1024 * 1024;
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const RATE = { perHour: 12, perDay: 40 };

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const anthropic = new Anthropic();

/* ---- rate limiting ------------------------------------------------------
   In-memory, so it resets on deploy and is per-machine. Fine for a
   single-machine personal tool; swap for a shared store before scaling out. */
const hits = new Map();

function rateCheck(ip) {
  const now = Date.now();
  const hour = now - 3600_000;
  const day = now - 86_400_000;
  const list = (hits.get(ip) || []).filter((t) => t > day);
  const inHour = list.filter((t) => t > hour).length;

  if (list.length >= RATE.perDay) return { ok: false, scope: "day", retryAfter: 3600 };
  if (inHour >= RATE.perHour) return { ok: false, scope: "hour", retryAfter: 900 };

  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => t > day)) hits.delete(k);
  return { ok: true };
}

function clientIp(req) {
  const fwd = req.headers["fly-client-ip"] || req.headers["x-forwarded-for"];
  return String(fwd || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function send(res, status, body, headers = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...headers,
  });
  res.end(data);
}

/* ---- static -------------------------------------------------------------- */
async function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel.endsWith("/")) rel += "index.html";

  const full = path.resolve(ROOT, "." + rel);
  // path traversal guard — never serve outside the site root
  if (!full.startsWith(ROOT + path.sep) && full !== ROOT) return send(res, 403, { error: "Forbidden" });
  if (full.startsWith(path.join(ROOT, "server"))) return send(res, 404, { error: "Not found" });

  let stat;
  try {
    stat = await fsp.stat(full);
  } catch {
    return send(res, 404, { error: "Not found" });
  }
  if (stat.isDirectory()) return serveStatic(req, res, rel + "/");

  const ext = path.extname(full).toLowerCase();
  const isHashed = ext === ".woff2" || full.includes(`${path.sep}icons${path.sep}`);
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
    "content-length": stat.size,
    "cache-control": isHashed ? "public, max-age=31536000" : "public, max-age=300",
    "x-content-type-options": "nosniff",
  });
  fs.createReadStream(full).pipe(res);
}

/* ---- body ---------------------------------------------------------------- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function validateImages(input) {
  if (!Array.isArray(input) || input.length === 0) throw badRequest("Send at least one page image.");
  if (input.length > MAX_IMAGES) throw badRequest(`Send at most ${MAX_IMAGES} pages at a time.`);

  return input.map((img, i) => {
    const page = i + 1;
    if (!img || typeof img !== "object") throw badRequest(`Page ${page} is malformed.`);
    if (!ALLOWED_MEDIA.has(img.media_type)) throw badRequest(`Page ${page} must be JPEG, PNG, WebP, or GIF.`);
    if (typeof img.data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(img.data)) {
      throw badRequest(`Page ${page} is not valid base64 image data.`);
    }
    if (Math.floor((img.data.length * 3) / 4) > MAX_IMAGE_BYTES) {
      throw badRequest(`Page ${page} is over ${MAX_IMAGE_BYTES / 1024 / 1024}MB. Retake it at a lower resolution.`);
    }
    return { type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } };
  });
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400, safe: true });
}

/* ---- analyze ------------------------------------------------------------- */
async function analyze(req, res) {
  const ip = clientIp(req);
  const limit = rateCheck(ip);
  if (!limit.ok) {
    return send(
      res,
      429,
      { error: `Rate limit reached for this ${limit.scope}. Try again shortly.` },
      { "retry-after": String(limit.retryAfter) }
    );
  }

  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString("utf8"));
  } catch (e) {
    if (e.status === 413) return send(res, 413, { error: "Those images are too large. Retake at a lower resolution." });
    return send(res, 400, { error: "Could not read the request." });
  }

  let imageBlocks;
  try {
    imageBlocks = validateImages(payload?.images);
  } catch (e) {
    return send(res, e.status || 400, { error: e.message });
  }

  const context = typeof payload?.context === "string" ? payload.context.slice(0, 600).trim() : "";
  const started = Date.now();

  try {
    const response = await anthropic.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      system: BRIEF_SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { format: zodOutputFormat(BriefSchema), effort: "high" },
      messages: [
        {
          role: "user",
          content: [
            ...imageBlocks,
            {
              type: "text",
              text:
                `These are ${imageBlocks.length} page image(s) from a closing package, in order. ` +
                `Produce my pre-signing brief.` +
                (context ? `\n\nWhat I already know about this signing: ${context}` : ""),
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      log({ ip, status: 422, ms: Date.now() - started, pages: imageBlocks.length, note: "refusal" });
      return send(res, 422, { error: "The model declined to analyze this document. Try a clearer photo of the page." });
    }

    const brief = response.parsed_output;
    if (!brief) {
      log({ ip, status: 502, ms: Date.now() - started, pages: imageBlocks.length, note: "unparsed" });
      return send(res, 502, { error: "The analysis came back malformed. Try again." });
    }

    log({
      ip,
      status: 200,
      ms: Date.now() - started,
      pages: imageBlocks.length,
      in: response.usage?.input_tokens,
      out: response.usage?.output_tokens,
    });
    return send(res, 200, { brief });
  } catch (err) {
    const status =
      err instanceof Anthropic.RateLimitError ? 429
      : err instanceof Anthropic.AuthenticationError ? 500
      : err instanceof Anthropic.BadRequestError ? 400
      : err instanceof Anthropic.APIConnectionError ? 504
      : 500;

    const message =
      status === 429 ? "Upstream rate limit. Wait a moment and try again."
      : status === 504 ? "Could not reach the analysis service. Check your connection."
      : status === 400 ? "The service rejected those images. Try re-photographing the page."
      : "Analysis failed. Try again.";

    // err.message may quote document text — never log it.
    log({ ip, status, ms: Date.now() - started, pages: imageBlocks.length, note: err.constructor?.name });
    return send(res, status, { error: message });
  }
}

/* Structured log line. Deliberately carries no document content, no extracted
   figures, and no party names — only shape and outcome. */
function log(o) {
  // spread first, then override — the other order let the raw ip win
  console.log(JSON.stringify({ t: new Date().toISOString(), ...o, ip: hashIp(o.ip) }));
}

function hashIp(ip) {
  let h = 0;
  for (let i = 0; i < ip.length; i++) h = (h * 31 + ip.charCodeAt(i)) | 0;
  return "ip_" + (h >>> 0).toString(36);
}

/* ---- server -------------------------------------------------------------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = req.url || "/";

    if (url === "/api/health") return send(res, 200, { ok: true, keyConfigured: Boolean(process.env.ANTHROPIC_API_KEY) });

    if (url.startsWith("/api/analyze")) {
      if (req.method !== "POST") return send(res, 405, { error: "Use POST." }, { allow: "POST" });
      if (!process.env.ANTHROPIC_API_KEY) {
        return send(res, 503, { error: "The analyzer is not configured on this server yet." });
      }
      return await analyze(req, res);
    }

    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed." });
    return await serveStatic(req, res, url);
  } catch (err) {
    console.log(JSON.stringify({ t: new Date().toISOString(), status: 500, note: "unhandled" }));
    if (!res.headersSent) send(res, 500, { error: "Server error." });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      msg: "listening",
      port: PORT,
      analyzer: process.env.ANTHROPIC_API_KEY ? "configured" : "NOT CONFIGURED — set ANTHROPIC_API_KEY",
    })
  );
});
