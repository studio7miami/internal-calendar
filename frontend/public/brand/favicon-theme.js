/* Studio 7 favicon: plain PNG only. Light = favicon.png as-is; dark = favicon-dark.png (inverted art). */
(function () {
  var V = "7";
  var ICON_LIGHT = "/brand/favicon.png?v=" + V;
  var ICON_DARK = "/brand/favicon-dark.png?v=" + V;

  function getTheme() {
    try {
      var t = (localStorage.getItem("theme") || "light").toLowerCase();
      if (t === "dark" || t === "light") return t;
    } catch (e) {}
    try {
      if (document.documentElement.classList.contains("dark")) return "dark";
    } catch (e) {}
    return "light";
  }

  function ensureLink() {
    var el = document.getElementById("studio7-favicon");
    if (el) return el;
    el = document.createElement("link");
    el.id = "studio7-favicon";
    el.rel = "icon";
    el.type = "image/png";
    document.head.appendChild(el);
    return el;
  }

  function removeLegacyFavicons() {
    var links = document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]');
    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      if (!l || l.id === "studio7-favicon") continue;
      if (l.getAttribute("rel") === "apple-touch-icon") continue;
      try {
        l.parentNode && l.parentNode.removeChild(l);
      } catch (e) {}
    }
  }

  function sync(theme) {
    removeLegacyFavicons();
    var link = ensureLink();
    link.href = theme === "dark" ? ICON_DARK : ICON_LIGHT;
  }

  window.__S7_SYNC_FAVICON__ = sync;
  sync(getTheme());

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      sync(getTheme());
    });
  }

  var last = getTheme();
  var n = 0;
  var id = setInterval(function () {
    n++;
    var t = getTheme();
    if (t !== last) {
      last = t;
      sync(t);
    }
    if (n > 40) clearInterval(id);
  }, 500);
})();
