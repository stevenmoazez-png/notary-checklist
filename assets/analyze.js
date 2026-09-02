(function () {
  "use strict";

  var MAX_PAGES = 6;
  var MAX_EDGE = 2000;   // downscale before upload — phone photos are far larger than needed
  var QUALITY = 0.82;

  var pages = [];        // { name, dataUrl, media_type, data }

  var $ = function (id) { return document.getElementById(id); };
  var fileInput = $("file"), drop = $("drop"), list = $("pages");
  var go = $("go"), hint = $("hint"), status = $("status"), brief = $("brief");

  // clear any passcode a previous version of this page stored on the device
  try { window.localStorage.removeItem("nsa-office-passcode"); } catch (e) {}

  /* ---------- helpers ---------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   // textContent, never innerHTML — model output is untrusted
    return n;
  }

  function setStatus(msg, kind) {
    status.className = "status on" + (kind === "err" ? " err" : "");
    status.textContent = "";
    if (kind === "load") status.appendChild(el("span", "spin"));
    status.appendChild(document.createTextNode(msg));
  }

  function clearStatus() { status.className = "status"; status.textContent = ""; }

  /* ---------- image intake ---------- */

  function downscale(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        var c = document.createElement("canvas");
        c.width = cw; c.height = ch;
        var ctx = c.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, cw, ch);
        var dataUrl = c.toDataURL("image/jpeg", QUALITY);
        resolve({
          name: file.name || "page",
          dataUrl: dataUrl,
          media_type: "image/jpeg",
          data: dataUrl.slice(dataUrl.indexOf(",") + 1)
        });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Could not read " + (file.name || "that image"))); };
      img.src = url;
    });
  }

  function render() {
    list.textContent = "";
    pages.forEach(function (p, i) {
      var li = el("li");
      var img = el("img");
      img.src = p.dataUrl;
      img.alt = "Page " + (i + 1);
      li.appendChild(img);
      li.appendChild(el("span", "n", String(i + 1)));
      var x = el("button", "x", "×");
      x.type = "button";
      x.title = "Remove page " + (i + 1);
      x.setAttribute("aria-label", "Remove page " + (i + 1));
      x.addEventListener("click", function () { pages.splice(i, 1); render(); });
      li.appendChild(x);
      list.appendChild(li);
    });
    go.disabled = pages.length === 0;
    hint.textContent = pages.length === 0
      ? "Add at least one page"
      : pages.length + (pages.length === 1 ? " page ready" : " pages ready, in order");
  }

  async function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList).filter(function (f) { return /^image\//.test(f.type); });
    if (!files.length) return setStatus("Those files aren't images.", "err");
    var room = MAX_PAGES - pages.length;
    if (room <= 0) return setStatus("That's the " + MAX_PAGES + "-page maximum. Remove one first.", "err");

    clearStatus();
    for (var i = 0; i < Math.min(files.length, room); i++) {
      try { pages.push(await downscale(files[i])); render(); }
      catch (e) { setStatus(e.message, "err"); }
    }
    if (files.length > room) setStatus("Added the first " + room + " — that's the " + MAX_PAGES + "-page maximum.", "err");
  }

  fileInput.addEventListener("change", function () { addFiles(fileInput.files); fileInput.value = ""; });

  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); });
  });
  drop.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  /* Paste anywhere on the page — screenshots are the common case, and the
     clipboard is usually where they already are. */
  document.addEventListener("paste", function (e) {
    var cd = e.clipboardData;
    if (!cd) return;

    var files = [];
    if (cd.files && cd.files.length) {
      files = Array.prototype.slice.call(cd.files);
    } else if (cd.items) {
      for (var i = 0; i < cd.items.length; i++) {
        if (cd.items[i].kind === "file") {
          var f = cd.items[i].getAsFile();
          if (f) files.push(f);
        }
      }
    }

    var images = files.filter(function (f) { return /^image\//.test(f.type); });
    if (!images.length) {
      // don't hijack ordinary text pastes into the context box
      if (e.target && e.target.tagName === "TEXTAREA") return;
      if (cd.types && Array.prototype.indexOf.call(cd.types, "Files") !== -1) {
        setStatus("That clipboard item isn't an image.", "err");
      }
      return;
    }

    e.preventDefault();
    addFiles(images);
  });

  /* ---------- rendering the brief ---------- */

  function section(cls, title, sub) {
    var s = el("section", "sec" + (cls ? " " + cls : ""));
    s.appendChild(el("h3", null, title));
    if (sub) s.appendChild(el("p", "sub", sub));
    return s;
  }

  function draw(b) {
    brief.textContent = "";
    brief.className = "brief on";

    // identity
    var head = el("div", "brief-head");
    head.appendChild(el("h2", "brief-doc", b.documentType || "Unidentified document"));
    var meta = el("div", "brief-meta");
    if (b.issuer) meta.appendChild(el("span", "chip", b.issuer));
    meta.appendChild(el("span", "chip " + (b.confidence === "high" ? "hi" : b.confidence === "low" ? "lo" : ""),
      "confidence: " + (b.confidence || "unknown")));
    head.appendChild(meta);
    brief.appendChild(head);

    if (b.readable === false && b.readabilityNote) {
      var warn = el("div", "anom high");
      warn.appendChild(el("div", "sev", "image quality"));
      warn.appendChild(el("div", "what", "This document may not be reliable to work from"));
      warn.appendChild(el("p", "detail", b.readabilityNote));
      brief.appendChild(warn);
    }

    if (b.headline) brief.appendChild(el("p", "brief-headline", b.headline));

    // the boundary — same words every time, the one rule everything serves
    var rule = el("div", "rule-note");
    var rb = el("b", null, "The boundary: ");
    rule.appendChild(rb);
    rule.appendChild(document.createTextNode("you locate and identify — you do not explain. Point at any line. Say what a line means and you've crossed into practicing law. Anything substantive goes to the escrow officer."));
    brief.appendChild(rule);

    // 1. top-to-bottom walkthrough, in document order
    if (b.walkthrough && b.walkthrough.length) {
      var w = section(null, "Top to bottom — what to point at", "In the order it's printed. Read this with the page next to you.");
      var ol = el("ol", "walk");
      b.walkthrough.forEach(function (s) {
        var li = el("li", "wsec");
        li.appendChild(el("h4", "wtitle", s.title || ""));
        if (s.lines && s.lines.length) {
          var tbl = el("table", "wlines");
          var tb = el("tbody");
          s.lines.forEach(function (ln) {
            var tr = el("tr");
            tr.appendChild(el("td", "wl", ln.label || ""));
            tr.appendChild(el("td", "wa", ln.amount || ""));
            tb.appendChild(tr);
          });
          tbl.appendChild(tb);
          li.appendChild(tbl);
        }
        if (s.pointAt) {
          var pa = el("p", "wpoint");
          pa.appendChild(el("span", "wcue", "Point at"));
          pa.appendChild(document.createTextNode(s.pointAt));
          li.appendChild(pa);
        }
        if (s.note) li.appendChild(el("p", "wnote", s.note));
        ol.appendChild(li);
      });
      w.appendChild(ol);
      brief.appendChild(w);
    }

    // 2. the sixty-second presentment
    if (b.script) {
      var sc = section(null, "Your 60-second presentment");
      var box = el("div", "script");
      box.appendChild(el("span", "cue", "Say this — then stop talking"));
      box.appendChild(el("p", null, b.script));
      var after = el("p", "after", "Finger lands on the biggest deduction when you say it. Then watch their face.");
      box.appendChild(after);
      sc.appendChild(box);
      brief.appendChild(sc);
    }

    // 3. flag and escalate
    if (b.flags && b.flags.length) {
      var f = section(null, "Flag-and-escalate list", "For escrow, not the client. Sorted by how much they matter.");
      var wrap = el("div", "anoms");
      b.flags
        .slice()
        .sort(function (a, c) {
          var r = { high: 0, medium: 1, low: 2 };
          return (r[a.severity] ?? 3) - (r[c.severity] ?? 3);
        })
        .forEach(function (a, i) {
          var n = el("div", "anom" + (a.severity === "high" ? " high" : ""));
          n.appendChild(el("div", "sev", (i + 1) + " · " + (a.severity || "note") + " · " +
            (a.severity === "high" ? "stop the signing" : a.severity === "medium" ? "raise with escrow first" : "mention when returning the package")));
          n.appendChild(el("div", "what", a.what || ""));
          if (a.detail) n.appendChild(el("p", "detail", a.detail));
          wrap.appendChild(n);
        });
      f.appendChild(wrap);
      brief.appendChild(f);
    }

    // 4. if you only do a few things
    if (b.neverSkip && b.neverSkip.length) {
      var ns = section("t1", "Never skip", "If you did only these, you did the job.");
      var nl = el("ol", "never");
      b.neverSkip.forEach(function (t) { nl.appendChild(el("li", null, t)); });
      ns.appendChild(nl);
      brief.appendChild(ns);
    }

    // 5. arithmetic
    if (b.mathCheck && b.mathCheck.checked) {
      var m = section(null, "Arithmetic", "Yours to verify — it's math, not interpretation.");
      var p = el("p", "math");
      var v = el("span", "verdict" + (b.mathCheck.balances === false ? " bad" : ""),
        b.mathCheck.balances === true ? "Columns tie. " : b.mathCheck.balances === false ? "Columns do NOT tie. " : "Not verifiable. ");
      p.appendChild(v);
      p.appendChild(document.createTextNode(b.mathCheck.detail || ""));
      m.appendChild(p);
      brief.appendChild(m);
    }

    // 6. prep notes
    if (b.notaryNotes && b.notaryNotes.length) {
      var nn = section(null, "Before you go");
      var ul2 = el("ul", "plain");
      b.notaryNotes.forEach(function (t) { ul2.appendChild(el("li", null, t)); });
      nn.appendChild(ul2);
      brief.appendChild(nn);
    }

    brief.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- submit ---------- */

  go.addEventListener("click", async function () {
    if (!pages.length) return;
    go.disabled = true;
    brief.className = "brief";
    brief.textContent = "";
    setStatus("Reading " + pages.length + (pages.length === 1 ? " page" : " pages") + " — this takes up to a minute.", "load");

    try {
      var res = await fetch("../api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          context: $("context").value.slice(0, 600),
          images: pages.map(function (p) { return { media_type: p.media_type, data: p.data }; })
        })
      });

      var body = await res.json().catch(function () { return {}; });
      if (res.status === 404) {
        throw new Error("The analyzer isn't running on this address — this is the static copy. Open the full version to use it.");
      }
      if (!res.ok) throw new Error(body.error || "Analysis failed (" + res.status + ").");
      if (!body.brief) throw new Error("The analysis came back empty.");

      clearStatus();
      draw(body.brief);
    } catch (e) {
      setStatus(e.message || "Something went wrong.", "err");
    } finally {
      go.disabled = pages.length === 0;
    }
  });

  $("print").addEventListener("click", function () { window.print(); });

  $("clear").addEventListener("click", function () {
    pages = [];
    $("context").value = "";
    brief.className = "brief";
    brief.textContent = "";
    clearStatus();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("../sw.js").catch(function () {});
    });
  }

  render();
})();
