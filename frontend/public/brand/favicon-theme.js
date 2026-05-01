/* Studio 7 favicon theme sync (public asset; no bundler).
   - Reads app theme from localStorage key "theme" (light|dark) OR <html class="dark">.
   - Uses /brand/favicon.png as the source art and swaps a data:image/svg+xml favicon.
   - Default art is a black palm on a light canvas; invert for dark mode so it reads on dark UI chrome.
*/
(function () {
  var PNG_PATH = "/brand/favicon.png?v=3";
  var cachedB64 = null;

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
    el.type = "image/svg+xml";
    try {
      el.setAttribute("sizes", "any");
    } catch (e) {}
    document.head.appendChild(el);
    return el;
  }

  function removeLegacyFavicons() {
    var links = document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]');
    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      if (!l || l.id === "studio7-favicon") continue;
      // Keep apple-touch-icon alone.
      if (l.getAttribute("rel") === "apple-touch-icon") continue;
      try {
        l.parentNode && l.parentNode.removeChild(l);
      } catch (e) {}
    }
  }

  function buildSvgDataUrl(theme) {
    if (!cachedB64) throw new Error("favicon png not loaded yet");
    var invert = theme === "dark";
    var filterBlock =
      '<defs><filter id="inv" color-interpolation-filters="sRGB">' +
      '<feColorMatrix type="matrix" values="-1 0 0 0 1 0 -1 0 0 1 0 0 -1 0 1 0 0 0 1 0"/>' +
      "</filter></defs>";

    var style =
      "<style>" +
      ".palm{" +
      (invert ? "filter:url(#inv);" : "filter:none;") +
      "}" +
      "</style>";

    var svg =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
      filterBlock +
      style +
      '<image class="palm" href="data:image/png;base64,' +
      cachedB64 +
      '" x="0" y="0" width="64" height="64" preserveAspectRatio="xMidYMid meet"/>' +
      "</svg>";

    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function loadPngB64() {
    if (cachedB64) return Promise.resolve(cachedB64);
    return fetch(PNG_PATH, { cache: "force-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("png fetch failed: " + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        var bytes = new Uint8Array(buf);
        var binary = "";
        for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        cachedB64 = btoa(binary);
        return cachedB64;
      });
  }

  function sync(theme) {
    removeLegacyFavicons();
    var link = ensureLink();
    loadPngB64()
      .then(function () {
        link.href = buildSvgDataUrl(theme);
      })
      .catch(function () {
        // Fallback: at least point to the png.
        link.removeAttribute("type");
        link.href = PNG_PATH;
      });
  }

  window.__S7_SYNC_FAVICON__ = sync;

  // Initial paint ASAP (script should be placed after static <link rel="icon"> in index.html).
  sync(getTheme());

  // Re-sync once the full head exists (guards against script order changes / late injections).
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      sync(getTheme());
    });
  }

  // If theme flips without a full reload, poll lightly (cheap) for a short window.
  var last = getTheme();
  var n = 0;
  var id = setInterval(function () {
    n++;
    var t = getTheme();
    if (t !== last) {
      last = t;
      sync(t);
    }
    if (n > 40) clearInterval(id); // ~20s
  }, 500);
})();
