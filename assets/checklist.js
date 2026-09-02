(function () {
  "use strict";

  var STORE = "nsa-wa-seller-v1";
  var boxes = Array.prototype.slice.call(document.querySelectorAll("label.item input[data-key]"));
  var count = document.getElementById("count");
  var fill = document.getElementById("fill");
  var track = fill ? fill.parentNode : null;

  /* localStorage can throw in private mode or with site data blocked. */
  function load() {
    try {
      var raw = window.localStorage.getItem(STORE);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function save(state) {
    try {
      window.localStorage.setItem(STORE, JSON.stringify(state));
    } catch (e) {
      /* progress just won't persist — the checklist still works */
    }
  }

  function update() {
    var done = boxes.filter(function (b) { return b.checked; }).length;
    var pct = boxes.length ? (done / boxes.length) * 100 : 0;
    count.textContent = done + " / " + boxes.length;
    fill.style.width = pct + "%";
    if (track) {
      track.setAttribute("aria-valuenow", String(done));
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", String(boxes.length));
    }
  }

  var state = load();
  boxes.forEach(function (b) {
    if (state[b.dataset.key]) b.checked = true;
    b.addEventListener("change", function () {
      if (b.checked) state[b.dataset.key] = 1;
      else delete state[b.dataset.key];
      save(state);
      update();
    });
  });
  update();

  var reset = document.getElementById("reset");
  if (reset) {
    reset.addEventListener("click", function () {
      boxes.forEach(function (b) { b.checked = false; });
      state = {};
      save(state);
      update();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  var print = document.getElementById("print");
  if (print) {
    print.addEventListener("click", function () { window.print(); });
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").catch(function () {
        /* offline support is an enhancement, not a requirement */
      });
    });
  }
})();
