(function () {
  "use strict";

  var MAX_PAGES = 6;
  var MAX_EDGE = 2000;   // downscale before upload — phone photos are far larger than needed
  var QUALITY = 0.82;

  var pages = [];        // { name, dataUrl, media_type, data }

  var $ = function (id) { return document.getElementById(id); };
  var fileInput = $("file"), drop = $("drop"), list = $("pages");
  var go = $("go"), hint = $("hint"), status = $("status"), brief = $("brief");

  /* Office passcode — typed once, kept on this device. localStorage can throw
     in private mode, so every access is guarded. */
  var PASS_KEY = "nsa-office-passcode";
  var pass = $("passcode");
  try { pass.value = window.localStorage.getItem(PASS_KEY) || ""; } catch (e) {}
  pass.addEventListener("change", function () {
    pass.classList.remove("bad");
    try {
      if (pass.value) window.localStorage.setItem(PASS_KEY, pass.value);
      else window.localStorage.removeItem(PASS_KEY);
    } catch (e) {}
  });

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

  function pointList(items) {
    var ul = el("ul", "points");
    items.forEach(function (p) {
      var li = el("li");
      var top = el("div", "pt-top");
      top.appendChild(el("span", "pt-label", p.label || ""));
      if (p.amount) top.appendChild(el("span", "pt-amt", p.amount));
      li.appendChild(top);
      if (p.why) li.appendChild(el("p", "pt-why", p.why));
      ul.appendChild(li);
    });
    return ul;
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

    // anomalies first — this is the stop signal
    if (b.anomalies && b.anomalies.length) {
      var s = section(null, "Discrepancies", "Verify these against the document before you go.");
      var wrap = el("div", "anoms");
      b.anomalies
        .slice()
        .sort(function (a, c) {
          var r = { high: 0, medium: 1, low: 2 };
          return (r[a.severity] ?? 3) - (r[c.severity] ?? 3);
        })
        .forEach(function (a) {
          var n = el("div", "anom" + (a.severity === "high" ? " high" : ""));
          n.appendChild(el("div", "sev", (a.severity || "note") + " · " +
            (a.severity === "high" ? "stop the signing" : a.severity === "medium" ? "raise with escrow first" : "mention on return")));
          n.appendChild(el("div", "what", a.what || ""));
          if (a.detail) n.appendChild(el("p", "detail", a.detail));
          wrap.appendChild(n);
        });
      s.appendChild(wrap);
      brief.appendChild(s);
    }

    // bottom line
    if (b.bottomLine && b.bottomLine.amount) {
      var bl = el("div", "bottomline");
      bl.appendChild(el("p", "lbl", b.bottomLine.label || "Bottom line"));
      bl.appendChild(el("p", "amt", b.bottomLine.amount));
      brief.appendChild(bl);
    }

    if (b.tier1 && b.tier1.length) {
      var t1 = section("t1", "Never skip", "Say these out loud and watch their face.");
      t1.appendChild(pointList(b.tier1));
      brief.appendChild(t1);
    }
    if (b.tier2 && b.tier2.length) {
      var t2 = section(null, "Point at briefly", "Ten seconds — run your finger down the column.");
      t2.appendChild(pointList(b.tier2));
      brief.appendChild(t2);
    }
    if (b.tier3 && b.tier3.length) {
      var t3 = section(null, "Know, don't volunteer", "For your eyes. Raising these invites questions you can't answer.");
      t3.appendChild(pointList(b.tier3));
      brief.appendChild(t3);
    }

    if (b.mathCheck && b.mathCheck.checked) {
      var m = section(null, "Arithmetic");
      var p = el("p", "math");
      var v = el("span", "verdict" + (b.mathCheck.balances === false ? " bad" : ""),
        b.mathCheck.balances === true ? "Columns tie. " : b.mathCheck.balances === false ? "Columns do NOT tie. " : "Not verifiable. ");
      p.appendChild(v);
      p.appendChild(document.createTextNode(b.mathCheck.detail || ""));
      m.appendChild(p);
      brief.appendChild(m);
    }

    if (b.script) {
      var sc = section(null, "The presentment");
      var box = el("div", "script");
      box.appendChild(el("span", "cue", "Say this — locating language only"));
      box.appendChild(el("p", null, b.script));
      sc.appendChild(box);
      brief.appendChild(sc);
    }

    if (b.stopRisk && b.stopRisk.length) {
      var sr = section(null, "Most likely to go wrong here");
      var ul = el("ul", "plain");
      b.stopRisk.forEach(function (r) {
        var li = el("li");
        var span = el("span");
        span.appendChild(el("b", null, r.trigger || ""));
        if (r.why) span.appendChild(document.createTextNode(" — " + r.why));
        li.appendChild(span);
        ul.appendChild(li);
      });
      sr.appendChild(ul);
      brief.appendChild(sr);
    }

    if (b.notaryNotes && b.notaryNotes.length) {
      var nn = section(null, "Prep notes");
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
    if (!pass.value.trim()) {
      pass.classList.add("bad");
      pass.focus();
      return setStatus("Enter the office passcode first.", "err");
    }
    go.disabled = true;
    brief.className = "brief";
    brief.textContent = "";
    setStatus("Reading " + pages.length + (pages.length === 1 ? " page" : " pages") + " — this takes up to a minute.", "load");

    try {
      var res = await fetch("../api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json", "x-passcode": pass.value.trim() },
        body: JSON.stringify({
          context: $("context").value.slice(0, 600),
          images: pages.map(function (p) { return { media_type: p.media_type, data: p.data }; })
        })
      });

      var body = await res.json().catch(function () { return {}; });
      if (res.status === 401) {
        try { window.localStorage.removeItem(PASS_KEY); } catch (e) {}
        pass.value = "";
        pass.classList.add("bad");
        pass.focus();
        throw new Error("That passcode isn't right. Check with the office and try again.");
      }
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
