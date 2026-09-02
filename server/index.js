import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
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

/* No authentication in front of this endpoint, so the rate limit is the
   only thing bounding spend. Per-IP numbers are sized so a small office
   sharing one address never trips them; the global cap bounds the worst
   day on the operator's card (globalPerDay × ~14¢).                       */
const RATE = { perHour: 60, perDay: 200, globalPerDay: 150 };

/* Only these top-level paths are ever served. Everything else in the image —
   server code, package manifests, deploy config, node_modules — is not. */
const PUBLIC_TOP = new Set(["index.html", "analyze", "assets", "sw.js", "manifest.webmanifest"]);

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
};

/* ---- Anthropic client -----------------------------------------------------
   Identity-linked API keys must name the workspace they act in. Standard
   workspace-scoped keys don't need it; the header is harmless either way.  */
const WORKSPACE_ID = (process.env.ANTHROPIC_WORKSPACE_ID || "").trim();
const anthropic = new Anthropic({
  defaultHeaders: WORKSPACE_ID ? { "anthropic-workspace-id": WORKSPACE_ID } : undefined,
});

/* ---- rate limiting ------------------------------------------------------
   In-memory, so it resets on deploy and is per-machine. Fine for a
   single-machine personal tool; swap for a shared store before scaling out. */
const hits = new Map();
const globalHits = [];

function rateCheck(ip) {
  const now = Date.now();
  const hour = now - 3600_000;
  const day = now - 86_400_000;

  while (globalHits.length && globalHits[0] <= day) globalHits.shift();
  if (globalHits.length >= RATE.globalPerDay) return { ok: false, scope: "day", retryAfter: 3600 };

  const list = (hits.get(ip) || []).filter((t) => t > day);
  const inHour = list.filter((t) => t > hour).length;

  if (list.length >= RATE.perDay) return { ok: false, scope: "day", retryAfter: 3600 };
  if (inHour >= RATE.perHour) return { ok: false, scope: "hour", retryAfter: 900 };

  list.push(now);
  globalHits.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => t > day)) hits.delete(k);
  return { ok: true };
}

function clientIp(req) {
  // fly-client-ip is set by Fly's edge and cannot be spoofed by the client.
  const fwd = req.headers["fly-client-ip"] || req.headers["x-forwarded-for"];
  return String(fwd || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

/* ---- logging ------------------------------------------------------------
   Log lines carry request shape and outcome only — never document content,
   figures, or party names. IPs are HMAC'd with a salt generated at boot and
   never written anywhere, so the log can correlate one client's requests
   within a process lifetime but cannot be reversed to an address.         */
const LOG_SALT = crypto.randomBytes(32);

function hashIp(ip) {
  return "ip_" + crypto.createHmac("sha256", LOG_SALT).update(String(ip)).digest("base64url").slice(0, 12);
}

function log(o) {
  console.log(JSON.stringify({ t: new Date().toISOString(), ...o, ip: o.ip ? hashIp(o.ip) : undefined }));
}

/* ---- responses ---------------------------------------------------------- */
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
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return send(res, 400, { error: "Bad path." });
  }
  if (rel.endsWith("/")) rel += "index.html";

  const full = path.resolve(ROOT, "." + rel);
  if (!full.startsWith(ROOT + path.sep)) return send(res, 403, { error: "Forbidden" });

  const top = path.relative(ROOT, full).split(path.sep)[0];
  if (!PUBLIC_TOP.has(top)) return send(res, 404, { error: "Not found" });

  let stat;
  try {
    stat = await fsp.stat(full);
  } catch {
    return send(res, 404, { error: "Not found" });
  }
  if (stat.isDirectory()) return serveStatic(req, res, rel + "/");

  const ext = path.extname(full).toLowerCase();
  const immutable = ext === ".woff2" || full.includes(`${path.sep}icons${path.sep}`);
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
    "content-length": stat.size,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=300",
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(full).pipe(res);
}

/* ---- body ---------------------------------------------------------------- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const onData = (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        req.off("data", onData);
        req.resume(); // drain the rest so the 413 can actually be written
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        return;
      }
      chunks.push(c);
    };
    req.on("data", onData);
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
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
    if (e.status === 413) {
      return send(res, 413, { error: "Those images are too large. Retake at a lower resolution." }, { connection: "close" });
    }
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
  const base = { ip, pages: imageBlocks.length };

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
      log({ ...base, status: 422, ms: Date.now() - started, note: "refusal" });
      return send(res, 422, { error: "The model declined to analyze this document. Try a clearer photo of the page." });
    }

    const brief = response.parsed_output;
    if (!brief) {
      log({ ...base, status: 502, ms: Date.now() - started, note: "unparsed" });
      return send(res, 502, { error: "The analysis came back malformed. Try again." });
    }

    log({
      ...base,
      status: 200,
      ms: Date.now() - started,
      in: response.usage?.input_tokens,
      out: response.usage?.output_tokens,
    });
    return send(res, 200, { brief });
  } catch (err) {
    // Most-specific first. Configuration problems get a distinct message so
    // they are diagnosable from the UI instead of hiding behind a generic 500.
    let status = 500;
    let message = "Analysis failed. Try again.";

    if (err instanceof Anthropic.AuthenticationError) {
      message = "The server's API key was rejected. The key needs to be re-set.";
    } else if (err instanceof Anthropic.PermissionDeniedError) {
      status = 500;
      message = "The server's API key doesn't have access to this model or workspace.";
    } else if (err instanceof Anthropic.RateLimitError) {
      status = 429;
      message = "Upstream rate limit. Wait a moment and try again.";
    } else if (err instanceof Anthropic.BadRequestError) {
      status = 400;
      message = "The service rejected the request. If this keeps happening, the server configuration needs attention.";
    } else if (err instanceof Anthropic.APIConnectionError) {
      status = 504;
      message = "Could not reach the analysis service. Check your connection.";
    }

    // A 4xx from the API describes the request, not the document — log a
    // truncated field path so it is diagnosable. Never log 5xx bodies.
    const apiMsg = err?.error?.error?.message;
    const detail = status === 400 && apiMsg ? String(apiMsg).slice(0, 220) : undefined;

    log({ ...base, status, ms: Date.now() - started, note: err.constructor?.name, detail });
    return send(res, status, { error: message });
  }
}

/* ---- server -------------------------------------------------------------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = req.url || "/";

    if (url === "/api/health") {
      return send(res, 200, {
        ok: true,
        keyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
        workspaceConfigured: Boolean(WORKSPACE_ID),
      });
    }

    if (url.startsWith("/api/analyze")) {
      if (req.method !== "POST") return send(res, 405, { error: "Use POST." }, { allow: "POST" });
      if (!process.env.ANTHROPIC_API_KEY) {
        return send(res, 503, { error: "The analyzer is not configured on this server yet." });
      }
      return await analyze(req, res);
    }

    if (url.startsWith("/api/")) return send(res, 404, { error: "Not found" });

    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed." });
    return await serveStatic(req, res, url);
  } catch (err) {
    log({ status: 500, note: "unhandled", kind: err?.constructor?.name });
    if (!res.headersSent) send(res, 500, { error: "Server error." });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  log({
    msg: "listening",
    port: PORT,
    analyzer: process.env.ANTHROPIC_API_KEY ? "configured" : "NOT CONFIGURED — set ANTHROPIC_API_KEY",
    workspace: WORKSPACE_ID ? "set" : "not set",
  });
});
