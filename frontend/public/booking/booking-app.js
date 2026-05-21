/**
 * Studio 7 Miami public booking — book.studio7.miami
 * Talks to FastAPI /api/public/booking/* (Supabase bookings table on the server).
 */
(function () {
  function resolveApiBase() {
    const override = (window.S7_BOOKING_API || "").replace(/\/+$/, "");
    if (override) return override;
    if (location.hostname === "book.studio7.miami") return "https://api.studio7.miami/api";
    const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (local) return "/api";
    return "/api";
  }
  const API_BASE = resolveApiBase();

  function serviceSlugFromUrl() {
    const raw = new URLSearchParams(location.search).get("service");
    return (raw || "portraits").trim().toLowerCase();
  }

  function formatServiceName(slug) {
    return slug
      .split("-")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }

  const SERVICES_UI = {
    portraits: {
      meta: "90-minute session",
      price: 350,
      desc: "Explore, experiment, and walk away with images that actually feel like you.",
      includes: ["90-minute session", "9 professionally edited photos", "5–7 day turnaround | 1-day rush delivery available"],
    },
    "beauty-headshots": {
      meta: "30-minute session",
      price: 300,
      desc: "Your presence, elevated — two polished looks and a gallery built to make an impression.",
      includes: ["30-minute session", "2 reels + 6 professionally edited photos", "5–7 day turnaround | 1-day rush delivery available"],
    },
    "theatrical-headshots": {
      meta: "30-minute session",
      price: 255,
      desc: "Built for the performer — two styled looks for casting and creative submissions.",
      includes: ["30-minute session", "2 styled looks + 6 professionally edited photos", "5–7 day turnaround | 1-day rush delivery available"],
    },
    "standard-headshots": {
      meta: "30-minute session",
      price: 225,
      desc: "Clean, confident, professional — timeless white-backdrop headshots.",
      includes: ["30-minute session", "6 professionally edited photos", "5–7 day turnaround | 1-day gallery delivery"],
    },
    "passport-photos": {
      meta: "15-minute session",
      price: 50,
      desc: "Official passport or visa photo — shot to meet U.S. specifications.",
      includes: ["15-minute in-studio session", "Compliant print + digital file"],
    },
  };

  const state = {
    serviceSlug: "portraits",
    servicePrice: 350,
    serviceName: "Portraits",
    addonMuaCents: 20000,
    addon: false,
    dateIso: null,
    dateLabel: null,
    time: null,
    shooterId: null,
    shooterDisplay: null,
    bookingConfirmed: false,
    paymentsConnected: true,
  };

  let AVAILABLE = {};
  let shootersList = [];
  let apiServices = [];
  const _now = new Date();
  let currentYear = _now.getFullYear();
  let currentMonth = _now.getMonth();
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  async function apiGet(path) {
    const res = await fetch(API_BASE + path, { headers: { Accept: "application/json" } });
    const text = await res.text();
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (text.trim().startsWith("<") && !ct.includes("json")) {
      throw new Error("Booking API unavailable. Restart the dev server (npm start) and reload.");
    }
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error("Invalid response from booking server.");
    }
    if (!res.ok) throw new Error(data.detail || data.message || "Request failed");
    return data;
  }

  async function apiPost(path, body) {
    const res = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { detail: text };
    }
    if (!res.ok) throw new Error(data.detail || data.message || "Request failed");
    return data;
  }

  function getMonthKey(y, m) {
    return y + "-" + String(m + 1).padStart(2, "0");
  }

  function getActiveDates(y, m) {
    return Object.keys(AVAILABLE[getMonthKey(y, m)] || {}).map(Number);
  }

  function getTimes(y, m, d) {
    return (AVAILABLE[getMonthKey(y, m)] || {})[d] || [];
  }

  function formatMoney(n) {
    return "$" + n;
  }

  function showError(msg) {
    const el = document.getElementById("bookingError");
    if (!el) return;
    if (msg) {
      el.textContent = msg;
      el.style.display = "block";
    } else {
      el.textContent = "";
      el.style.display = "none";
    }
  }

  async function loadAvailability() {
    try {
      const data = await apiGet(
        "/public/booking/availability?service=" +
          encodeURIComponent(state.serviceSlug) +
          "&year=" +
          currentYear +
          "&month=" +
          (currentMonth + 1)
      );
      AVAILABLE = {};
      const key = getMonthKey(currentYear, currentMonth);
      AVAILABLE[key] = data.days || {};
      renderCalendar();
    } catch (e) {
      console.error(e);
      const msg =
        e && e.message === "Load failed"
          ? "Could not reach the booking server. Refresh the page or try again shortly."
          : e.message || "Could not load availability.";
      showError(msg);
      renderCalendar();
    }
  }

  async function loadConfig() {
    const cfg = await apiGet("/public/booking/config");
    apiServices = cfg.services || [];
    const pay = cfg.payments || {};
    state.paymentsConnected = pay.connected !== false && pay.configured !== false;
    if (pay.configured === false) {
      showError("Online payment is not set up on the server yet.");
      state.paymentsConnected = false;
    } else if (!pay.connected) {
      showError("Online payment is temporarily unavailable. Please contact the studio to book.");
      state.paymentsConnected = false;
    }
    const slug = serviceSlugFromUrl();
    const svc = apiServices.find((s) => s.slug === slug) || apiServices.find((s) => s.slug === "portraits") || apiServices[0];
    if (svc) applyService(svc);
    else initServiceFromUi(slug);
  }

  function applyService(svc) {
    state.serviceSlug = svc.slug;
    state.serviceName = svc.name;
    state.servicePrice = Math.round((svc.price_cents || 0) / 100);
    state.addonMuaCents = svc.addon_mua_cents || 20000;
    const ui = SERVICES_UI[svc.slug] || {};
    document.getElementById("svcName").textContent = svc.name;
    document.getElementById("svcMeta").textContent =
      (ui.meta || svc.duration_minutes + "-minute session") + " | $" + state.servicePrice;
    document.getElementById("svcDesc").textContent = ui.desc || "";
    const ul = document.getElementById("svcIncludes");
    ul.innerHTML = (ui.includes || []).map((i) => "<li>" + i + "</li>").join("");
    document.getElementById("summaryService").textContent = "$" + state.servicePrice;
    const addonCard = document.querySelector(".addon-card");
    if (addonCard) addonCard.style.display = svc.addon_mua_available ? "" : "none";
    const addonPrice = document.querySelector(".addon-price");
    if (addonPrice) addonPrice.textContent = "+$" + Math.round(state.addonMuaCents / 100);
    if (!svc.calendar_configured) {
      showError("Online booking is not fully configured yet. Please contact the studio.");
    }
    updateSummary();
    loadAvailability();
  }

  function initServiceFromUi(slug) {
    const key = slug in SERVICES_UI ? slug : "portraits";
    const ui = SERVICES_UI[key];
    const price = ui.price ?? 350;
    state.serviceSlug = key;
    state.serviceName = formatServiceName(key);
    state.servicePrice = price;
    document.getElementById("svcName").textContent = state.serviceName;
    document.getElementById("svcMeta").textContent = ui.meta + " | $" + price;
    document.getElementById("svcDesc").textContent = ui.desc;
    document.getElementById("svcIncludes").innerHTML = ui.includes.map((i) => "<li>" + i + "</li>").join("");
    updateSummary();
  }

  function updateSteps() {
    document.getElementById("step1").className = "step-item done";
    document.getElementById("step2").className =
      "step-item " + (state.dateLabel && state.time ? "done" : "active");
    document.getElementById("step3").className =
      "step-item " + (state.shooterId ? "done" : state.dateLabel && state.time ? "active" : "");
  }

  function updateSummary() {
    const addonDollars = state.addon ? Math.round(state.addonMuaCents / 100) : 0;
    document.getElementById("summaryAddon").textContent = state.addon ? formatMoney(addonDollars) : "$0";
    document.getElementById("summaryDateTime").textContent =
      state.dateLabel && state.time ? state.dateLabel + " at " + state.time : state.dateLabel || "—";
    document.getElementById("summaryShooter").textContent = state.shooterDisplay || "Select after time";
    document.getElementById("summaryTotal").textContent = formatMoney(state.servicePrice + addonDollars);
    updatePayBtn();
    updateSteps();
  }

  function renderCalendar() {
    const wrap = document.getElementById("calDays");
    wrap.innerHTML = "";
    document.getElementById("cal-month").textContent = MONTHS[currentMonth] + " " + currentYear;
    const today = new Date();
    const todayY = today.getFullYear();
    const todayM = today.getMonth();
    const todayD = today.getDate();
    const isCurrentMonth = currentYear === todayY && currentMonth === todayM;
    const todayBtnEl = document.getElementById("todayBtn");
    if (todayBtnEl) todayBtnEl.style.display = isCurrentMonth ? "none" : "flex";

    const firstOffset = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate();
    const active = getActiveDates(currentYear, currentMonth);

    for (let i = 0; i < firstOffset; i++) {
      const btn = document.createElement("button");
      btn.className = "cal-day disabled overflow-day";
      btn.style.cssText = "opacity:0.38;font-size:13px;";
      btn.textContent = prevMonthDays - firstOffset + 1 + i;
      wrap.appendChild(btn);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const isPast =
        currentYear < todayY ||
        (currentYear === todayY && currentMonth < todayM) ||
        (currentYear === todayY && currentMonth === todayM && d < todayD);
      const hasSlots = active.includes(d) && !isPast;
      const btn = document.createElement("button");
      btn.className = "cal-day" + (hasSlots ? " has-slots" : " disabled");
      if (isCurrentMonth && d === todayD) btn.className += " today";
      btn.textContent = d;
      if (hasSlots) btn.addEventListener("click", () => selectDate(d, btn));
      wrap.appendChild(btn);
    }

    const totalCells = firstOffset + daysInMonth;
    const trailingCount = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let d = 1; d <= trailingCount; d++) {
      const btn = document.createElement("button");
      btn.className = "cal-day disabled overflow-day";
      btn.style.cssText = "opacity:0.38;font-size:13px;";
      btn.textContent = d;
      wrap.appendChild(btn);
    }
  }

  window.goToday = function () {
    const t = new Date();
    currentYear = t.getFullYear();
    currentMonth = t.getMonth();
    loadAvailability();
  };

  window.changeMonth = function (dir) {
    const newM = currentMonth + dir;
    const newY = currentYear + (newM > 11 ? 1 : newM < 0 ? -1 : 0);
    const adjM = ((newM % 12) + 12) % 12;
    const todayNow = new Date();
    const minY = todayNow.getFullYear();
    const minM = todayNow.getMonth();
    const maxDate = new Date(todayNow.getFullYear() + 1, todayNow.getMonth(), 1);
    const proposed = new Date(newY, adjM, 1);
    if (proposed < new Date(minY, minM, 1)) return;
    if (proposed > maxDate) return;
    currentYear = newY;
    currentMonth = adjM;
    state.dateIso = null;
    state.dateLabel = null;
    state.time = null;
    state.shooterId = null;
    document.getElementById("timeCard").classList.add("locked");
    document.getElementById("shooterCard").classList.add("locked");
    document.getElementById("timeGrid").innerHTML = "";
    loadAvailability();
    updateSummary();
  };

  function selectDate(day, el) {
    document.querySelectorAll(".cal-day").forEach((d) => d.classList.remove("selected"));
    el.classList.add("selected");
    state.dateIso =
      currentYear +
      "-" +
      String(currentMonth + 1).padStart(2, "0") +
      "-" +
      String(day).padStart(2, "0");
    state.dateLabel = MONTHS[currentMonth] + " " + day + ", " + currentYear;
    state.time = null;
    state.shooterId = null;
    document.getElementById("timeCard").classList.remove("locked");
    document.getElementById("shooterCard").classList.add("locked");
    renderTimes(day);
    updateSummary();
  }

  function renderTimes(day) {
    const grid = document.getElementById("timeGrid");
    grid.innerHTML = "";
    getTimes(currentYear, currentMonth, day).forEach((time) => {
      const btn = document.createElement("button");
      btn.className = "time-slot";
      btn.textContent = time;
      btn.addEventListener("click", () => selectTime(time, btn));
      grid.appendChild(btn);
    });
  }

  function selectTime(time, el) {
    document.querySelectorAll(".time-slot").forEach((t) => t.classList.remove("selected"));
    el.classList.add("selected");
    state.time = time;
    state.shooterId = null;
    document.getElementById("shooterCard").classList.remove("locked");
    updateSummary();
  }

  async function loadShooters() {
    const body = document.getElementById("shooterBody");
    try {
      const data = await apiGet("/public/booking/shooters");
      shootersList = data.shooters || [];
      body.innerHTML = "";
      if (!shootersList.length) {
        body.innerHTML =
          '<div style="grid-column:1/-1;font-size:12px;color:var(--text-tertiary);">No team members available right now.</div>';
        return;
      }
      shootersList.forEach((member) => {
        const name = member.name || "Team member";
        const initials = name
          .split(" ")
          .map((w) => w[0])
          .join("")
          .slice(0, 2)
          .toUpperCase();
        const bubble = document.createElement("div");
        bubble.className = "shooter-bubble";
        bubble.setAttribute("role", "button");
        bubble.setAttribute("tabindex", "0");
        bubble.innerHTML =
          '<div class="shooter-avatar">' +
          initials +
          "</div><div class=\"shooter-bubble-name\">" +
          name +
          "</div>" +
          (member.gallery_url
            ? '<a class="shooter-gallery-link" href="' +
              member.gallery_url +
              '" target="_blank" rel="noopener" onclick="event.stopPropagation()">View work</a>'
            : "");
        bubble.addEventListener("click", () => selectShooter(bubble, member.id, name));
        body.appendChild(bubble);
      });
    } catch (e) {
      console.error(e);
      body.innerHTML =
        '<div style="grid-column:1/-1;font-size:12px;color:var(--text-tertiary);">Could not load team.</div>';
    }
  }

  function selectShooter(el, id, name) {
    if (document.getElementById("shooterCard").classList.contains("locked")) return;
    document.querySelectorAll(".shooter-bubble").forEach((b) => b.classList.remove("selected"));
    el.classList.add("selected");
    state.shooterId = id;
    state.shooterDisplay = name;
    updateSummary();
  }

  function updatePayBtn() {
    const ready = state.dateIso && state.time && state.shooterId;
    const btn = document.getElementById("payBtn");
    const form = document.getElementById("clientForm");
    const note = document.getElementById("ctaNote");
    if (!btn || !form) return;
    if (ready && !state.bookingConfirmed && state.paymentsConnected) {
      form.style.display = "block";
      btn.disabled = false;
      btn.textContent = "Continue to payment";
      if (note) note.style.display = "";
    } else if (ready && !state.bookingConfirmed && !state.paymentsConnected) {
      form.style.display = "block";
      btn.disabled = true;
      btn.textContent = "Payment unavailable";
      if (note) {
        note.textContent = "Contact the studio to complete your booking.";
        note.style.display = "";
      }
    } else if (!ready) {
      form.style.display = "none";
      btn.disabled = true;
      btn.textContent = "Select date, time & shooter";
      if (note) {
        note.textContent =
          "You'll complete payment securely with Stripe. Your session is confirmed once payment succeeds.";
        note.style.display = "";
      }
    }
  }

  document.getElementById("muaAddon")?.addEventListener("click", () => {
    state.addon = !state.addon;
    document.getElementById("muaAddon").classList.toggle("active", state.addon);
    updateSummary();
  });

  document.getElementById("payBtn")?.addEventListener("click", async () => {
    if (!state.paymentsConnected) {
      showError("Online payment is temporarily unavailable. Please contact the studio to book.");
      return;
    }
    const name = document.getElementById("clientName").value.trim();
    const email = document.getElementById("clientEmail").value.trim();
    if (!name || !email) {
      showError("Please enter your name and email.");
      return;
    }
    const btn = document.getElementById("payBtn");
    btn.disabled = true;
    btn.textContent = "Redirecting to payment…";
    showError("");
    try {
      const res = await apiPost("/public/booking/request", {
        service_slug: state.serviceSlug,
        date: state.dateIso,
        start_time: state.time,
        shooter_id: state.shooterId,
        client_name: name,
        client_email: email,
        addon_mua: state.addon,
      });
      if (res.checkout_url) {
        window.location.href = res.checkout_url;
        return;
      }
      showError("Payment could not be started. Please try again.");
      btn.disabled = false;
      btn.textContent = "Continue to payment";
    } catch (e) {
      showError(e.message || "Booking failed. Please try another time.");
      btn.disabled = false;
      btn.textContent = "Continue to payment";
    }
  });

  (function handleReturnFromStripe() {
    const params = new URLSearchParams(location.search);
    if (params.get("booking") === "confirmed") {
      document.getElementById("confirmPanel").style.display = "block";
      document.getElementById("clientForm").style.display = "none";
      document.getElementById("payBtn").style.display = "none";
      document.getElementById("ctaNote").style.display = "none";
      document.getElementById("confirmDetail").innerHTML =
        "Payment received. We'll email you shortly with session details.";
    } else if (params.get("booking") === "cancelled") {
      showError("Payment was cancelled. Your time slot may still be available — try again.");
    }
  })();

  /* Gallery uses CSS :hover { animation-play-state: paused } — same as original HTML */

  (function initTheme() {
    try {
      const saved = localStorage.getItem("s7-booking-theme");
      if (saved === "dark" || saved === "light") {
        document.documentElement.setAttribute("data-theme", saved);
      }
    } catch (_) {}
  })();

  document.getElementById("themeToggle")?.addEventListener("click", () => {
    const root = document.documentElement;
    const isDark = root.getAttribute("data-theme") === "dark";
    const next = isDark ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("s7-booking-theme", next);
    } catch (_) {}
  });

  /* Paint service copy immediately — do not wait for /config API */
  initServiceFromUi(serviceSlugFromUrl());
  loadAvailability();

  async function boot() {
    renderCalendar();
    try {
      await loadConfig();
    } catch (e) {
      console.error(e);
      showError(e.message || "Could not connect to booking server.");
      renderCalendar();
    }
    try {
      await loadShooters();
    } catch (e) {
      console.error(e);
      const body = document.getElementById("shooterBody");
      if (body) {
        body.innerHTML =
          '<div style="grid-column:1/-1;font-size:12px;color:var(--text-tertiary);">Could not load team.</div>';
      }
    }
  }

  boot();
})();
