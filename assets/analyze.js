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

  /* ---------- checklist building blocks — same DOM as the standing checklist ---------- */

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function itemRow(it) {
    var li = el("li");
    var lab = el("label", "item");
    var box = el("input");
    box.type = "checkbox";
    lab.appendChild(box);
    var txt = el("span", "txt");
    if (it.action) {
      txt.appendChild(el("span", "act", it.action.trim()));
      txt.appendChild(document.createTextNode(" "));   // real space, so copy/print/screen readers read it right
    }
    txt.appendChild(el("b", null, it.label || ""));
    if (it.amount) txt.appendChild(el("span", "amt", it.amount));
    if (it.detail) txt.appendChild(el("span", "det", " — " + it.detail));
    lab.appendChild(txt);
    li.appendChild(lab);
    return li;
  }

  function itemList(items) {
    var ul = el("ul", "items");
    (items || []).forEach(function (it) { ul.appendChild(itemRow(it)); });
    return ul;
  }

  function phaseEl(num, title, when, items) {
    var s = el("section", "phase");
    var head = el("div", "phase-head");
    head.appendChild(el("span", "tab", pad2(num)));
    head.appendChild(el("h2", null, title || ""));
    s.appendChild(head);
    if (when) s.appendChild(el("p", "when", when));
    s.appendChild(itemList(items));
    return s;
  }

  /* ---------- progress, counted over the brief's own boxes ---------- */

  var countEl = $("count"), trackEl = $("track"), fillEl = $("fill"), spacerEl = $("spacer");

  function progress() {
    var boxes = brief.querySelectorAll('input[type="checkbox"]');
    if (!boxes.length) {
      countEl.textContent = "Pre-signing brief";
      trackEl.hidden = true; spacerEl.hidden = false;
      return;
    }
    var done = 0;
    for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) done++;
    countEl.textContent = done + " / " + boxes.length;
    fillEl.style.width = (done / boxes.length) * 100 + "%";
    trackEl.setAttribute("aria-valuenow", String(done));
    trackEl.setAttribute("aria-valuemin", "0");
    trackEl.setAttribute("aria-valuemax", String(boxes.length));
    trackEl.hidden = false; spacerEl.hidden = true;
  }
  brief.addEventListener("change", function (e) { if (e.target && e.target.type === "checkbox") progress(); });

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

    // the one rule everything else serves — same words every time
    var rule = el("div", "rule-note");
    rule.appendChild(el("b", null, "The one rule everything else serves: "));
    rule.appendChild(document.createTextNode("you locate and identify, you never explain. Point at any line on any page. Say what a line "));
    rule.appendChild(el("em", null, "means"));
    rule.appendChild(document.createTextNode(" and you have crossed into practicing law."));
    brief.appendChild(rule);

    var n = 0;

    // 01 — before you leave
    if (b.prep && b.prep.length) {
      brief.appendChild(phaseEl(++n, "Before you leave", "At your desk — the signing is won or lost here", b.prep));
    }

    // 02.. — the document, top to bottom
    (b.walkthrough || []).forEach(function (ph) {
      brief.appendChild(phaseEl(++n, ph.title, ph.when, ph.items));
    });

    // the sixty-second presentment
    if (b.script) {
      var box = el("div", "script");
      box.appendChild(el("span", "cue", "The sixty-second presentment — say this, then stop talking"));
      box.appendChild(el("p", null, b.script));
      box.appendChild(el("p", "after", "Finger lands on the biggest deduction as you say it. Silence is the tool — it gives them room to react while there's still time to fix it."));
      brief.appendChild(box);
    }

    // never skip
    if (b.neverSkip && b.neverSkip.length) {
      var ns = el("section", "panel");
      var nh = el("h2", null, "Never skip");
      nh.style.color = "var(--flag)";
      ns.appendChild(nh);
      ns.appendChild(el("p", "when", "If you did only these, you did the job."));
      ns.appendChild(itemList(b.neverSkip));
      brief.appendChild(ns);
    }

    // stop the signing — this document's version
    if (b.stop && b.stop.length) {
      var wrap = el("section", "panel");
      var st = el("div", "stop");
      st.appendChild(el("h2", null, "Stop the signing"));
      st.appendChild(el("p", "when", "Any one of these. You do not need a second reason."));
      var ul = el("ul");
      b.stop
        .slice()
        .sort(function (a, c) {
          var r = { high: 0, medium: 1, low: 2 };
          return (r[a.severity] ?? 3) - (r[c.severity] ?? 3);
        })
        .forEach(function (s) {
          var li = el("li");
          var span = el("span");
          var line = el("span");
          line.appendChild(el("span", "sevtag",
            s.severity === "high" ? "stop" : s.severity === "medium" ? "escrow first" : "on return"));
          line.appendChild(document.createTextNode(s.trigger || ""));
          span.appendChild(line);
          if (s.detail) span.appendChild(el("span", "sdet", s.detail));
          li.appendChild(span);
          ul.appendChild(li);
        });
      st.appendChild(ul);
      var then = el("p", "then");
      then.appendChild(el("b", null, "What stopping looks like: "));
      then.appendChild(document.createTextNode("stay calm, stay in the chair. \"I want to make sure this is right before you sign it — let me get your escrow officer on the phone.\" You never decide whether the closing proceeds. You make sure nobody signs something blind."));
      st.appendChild(then);
      wrap.appendChild(st);
      brief.appendChild(wrap);
    }

    // arithmetic
    if (b.mathCheck && b.mathCheck.checked) {
      var m = el("section", "panel");
      m.appendChild(el("h2", null, "Arithmetic"));
      m.appendChild(el("p", "when", "Yours to verify — it's math, not interpretation."));
      var p = el("p", "math");
      p.appendChild(el("span", "verdict" + (b.mathCheck.balances === false ? " bad" : ""),
        b.mathCheck.balances === true ? "Columns tie. " : b.mathCheck.balances === false ? "Columns do NOT tie. " : "Not verifiable. "));
      p.appendChild(document.createTextNode(b.mathCheck.detail || ""));
      m.appendChild(p);
      brief.appendChild(m);
    }

    progress();
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
    progress();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("../sw.js").catch(function () {});
    });
  }

  render();
})();
