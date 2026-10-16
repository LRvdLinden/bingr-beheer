// Bingr-beheer: praat alleen met de Edge Function `admin`. Token (12 uur) in sessionStorage.
(() => {
  "use strict";
  const CFG = window.BINGR_SUPABASE || {};
  const FN = `${CFG.url}/functions/v1/admin`;
  const KEY = "bingrAdmin";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = new Intl.NumberFormat("nl-NL");
  const fmtDate = (v) => (v ? new Date(v).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" }) : "—");
  const fmtDateTime = (v) => (v ? new Date(v).toLocaleString("nl-NL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
  function ago(v) {
    if (!v) return "nooit";
    const m = Math.round((Date.now() - Date.parse(v)) / 60000);
    if (m < 2) return "zojuist";
    if (m < 60) return `${m} min geleden`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} uur geleden`;
    const d = Math.round(h / 24);
    if (d === 1) return "gisteren";
    if (d < 30) return `${d} dagen geleden`;
    return fmtDate(v);
  }
  const PLATFORM = { browser: "Webbrowser", tizen: "Samsung TV", "?": "Onbekend" };
  const pname = (p) => PLATFORM[p] || p || "Onbekend";

  // ---- sessie ----
  function session() {
    try {
      const s = JSON.parse(sessionStorage.getItem(KEY) || "null");
      return s && Date.parse(s.expires_at) > Date.now() ? s : null;
    } catch { return null; }
  }
  function setSession(s) { try { s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY); } catch { /* privé-venster */ } }
  let mem = null; // als sessionStorage niet werkt
  const token = () => (session() || mem || {}).token;

  async function call(action, data = {}, withToken = true) {
    let res;
    try {
      res = await fetch(FN, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: CFG.anonKey || "" },
        body: JSON.stringify({ action, ...(withToken ? { token: token() } : {}), ...data }),
      });
    } catch { throw Object.assign(new Error("network"), { code: "network" }); }
    let body = {};
    try { body = await res.json(); } catch { /* leeg */ }
    if (res.status === 401 && withToken) { logout("Je sessie is verlopen. Log opnieuw in."); throw Object.assign(new Error("auth"), { code: "auth" }); }
    if (!res.ok) throw Object.assign(new Error(body.error || "server_error"), { code: body.error || "server_error", body });
    return body;
  }
  const ERR = {
    network: "Geen verbinding met de server.", server_error: "Er ging iets mis op de server.", not_found: "Niet gevonden.",
    too_soon: "Er is net al een reset-mail gestuurd. Probeer het over een minuut opnieuw.", reset_failed: "De reset-mail kon niet worden verstuurd.",
    smtp_not_configured: "E-mail is niet ingesteld op de server.", text_missing: "Vul een Nederlandse titel en tekst in.",
    bad_expires_at: "De verloopdatum moet in de toekomst liggen.",
    status_not_configured: "De statusmonitor is nog niet ingesteld (Backend-workflow draaien).", bad_url: "Vul een geldig http(s)-adres in (geen intern adres).",
    bad_interval: "Kies een geldig interval.", name_missing: "Vul een Nederlandse naam in.", bad_group: "Kies een groep.",
    builtin: "Een standaardmonitor kun je niet verwijderen; zet hem uit.", forbidden: "De statusfunctie weigerde de aanvraag.",
    support_not_configured: "Support is nog niet ingesteld (workflow Backend in iptv-ios-appletv draaien).",
    support_not_deployed: "De functie support staat nog niet online (workflow Backend in iptv-ios-appletv draaien).",
    support_forbidden: "De functie support weigerde de aanvraag (SUPPORT_ADMIN_SECRET klopt niet).",
    message_missing: "Typ eerst een bericht.", message_too_long: "Het bericht is te lang (max. 5000 tekens).",
    too_many_links: "Het bericht bevat te veel links.", bad_status: "Ongeldige status.", bad_number: "Ongeldig ticketnummer.",
    bad_id: "Ongeldig account.", reason_missing: "Vul een reden in (de klant ziet hem in de mail).",
    bad_until: "Kies een einddatum in de toekomst (minstens 1 minuut, hoogstens 10 jaar), of onbepaald.",
    block_failed: "Blokkeren is mislukt. Probeer het opnieuw.", unblock_failed: "Opheffen is mislukt. Probeer het opnieuw.",
    confirm_mismatch: "Het e-mailadres klopt niet. Typ het volledige adres of precies het adres zoals hierboven.",
    delete_failed: "Verwijderen is mislukt; er is niets gemaild. Probeer het opnieuw.",
    bad_plan: "Kies Gratis of Lifetime.", bad_max_streams: "Tegelijk kijken: een heel getal van 1 tot 50, of leeg voor de standaard.",
    bad_max_devices: "Apparaten: een heel getal van 1 tot 200, of leeg voor de standaard.", bad_settings: "Ongeldige instellingen.",
    // build 97
    invalid_token: "Ongeldige of verlopen link.", unknown_action: "Onbekende actie (vernieuw de pagina; het dashboard is misschien bijgewerkt).",
    bad_priority: "Ongeldige prioriteit.", rate_limited: "Te veel verzoeken achter elkaar. Wacht een minuut en probeer het opnieuw.",
    // downloads (builds, build_link)
    bad_platform: "Onbekend platform.", bad_file: "Ongeldige bestandsnaam.",
    build_not_found: "Deze build staat niet (meer) op de server. Vernieuw de lijst.",
    builds_not_configured: "Downloads nog niet ingericht: draai de workflow Builds.",
    builds_unreachable: "De server met de builds is niet bereikbaar. Probeer het later opnieuw.",
  };
  // ---- abonnementen (zelfde standaarden als de server, docs/ACCOUNT.md in iptv-ios-appletv) ----
  const PLAN_DEFAULTS = { free: { streams: 1, devices: 8 }, lifetime: { streams: 3, devices: 15 } };
  const PLAN_NAME = { free: "Gratis", lifetime: "Lifetime" };
  const PLAN_SOURCE = { legacy: "cadeau bij de invoering (bestaand account)", admin: "via het beheer", purchase: "gekocht" };
  const planObj = (p) => (p && typeof p === "object" ? p : { plan: "free" });
  const isCustom = (p) => p.max_streams != null || p.max_devices != null;
  function planChip(raw) {
    const p = planObj(raw), life = p.plan === "lifetime";
    const lim = isCustom(p) ? ` · ${p.max_streams ?? PLAN_DEFAULTS[life ? "lifetime" : "free"].streams} str./${p.max_devices ?? PLAN_DEFAULTS[life ? "lifetime" : "free"].devices} app.` : "";
    return `<span class="chip ${life ? "plan-life" : "plan-free"}" title="${esc(life ? `Lifetime${p.source ? ", " + (PLAN_SOURCE[p.source] || p.source) : ""}` : "Gratis")}${isCustom(p) ? " met eigen limieten" : ""}">${PLAN_NAME[life ? "lifetime" : "free"]}${esc(lim)}</span>`;
  }
  const errText = (e) => ERR[e.code] || ERR.server_error;

  let toastTimer;
  function toast(msg, bad = false) {
    const t = $("toast");
    t.textContent = msg; t.classList.toggle("bad", bad); t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
  }

  // ---- inloggen ----
  // achtergrond van het inlogscherm: schuine muur van covers (zoals de hero op bingr.online), alleen bij inloggen
  const COVERS = 36;
  function buildWall() {
    const wall = $("loginWall");
    if (!wall || wall.childElementCount) return;
    const ids = Array.from({ length: COVERS }, (_, i) => i + 1);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    const cols = 12, per = 8;
    for (let c = 0; c < cols; c++) {
      const col = document.createElement("div");
      col.className = "col";
      for (let r = 0; r < per; r++) {
        const img = document.createElement("img");
        img.src = `covers/c${String(ids[(c * 7 + r * 5) % ids.length]).padStart(2, "0")}.jpg`;
        img.alt = ""; img.decoding = "async"; img.loading = "lazy"; img.width = 300; img.height = 450;
        img.onload = () => img.classList.add("in");
        img.onerror = () => img.remove();
        col.appendChild(img);
      }
      wall.appendChild(col);
    }
  }
  function showLogin(msg) {
    buildWall();
    $("app").classList.add("hidden"); $("login").classList.remove("hidden");
    $("loginErr").textContent = msg || "";
    $("lu").focus();
  }
  function logout(msg) { setSession(null); mem = null; closeDrawer(); showLogin(msg); }
  $("logout").onclick = () => logout();
  $("loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const user = $("lu").value.trim(), password = $("lp").value;
    if (!user || !password) { $("loginErr").textContent = "Vul gebruikersnaam en wachtwoord in."; return; }
    $("loginBtn").disabled = true; $("loginErr").textContent = "";
    try {
      const r = await call("login", { user, password }, false);
      mem = r; setSession(r); $("lp").value = "";
      start();
    } catch (err) {
      const c = err.code;
      $("loginErr").textContent = c === "invalid_credentials" ? "Onjuiste gebruikersnaam of wachtwoord."
        : c === "locked" ? `Te veel pogingen. Probeer het over ${Math.ceil((err.body?.retry_after || 900) / 60)} minuten opnieuw.`
        : c === "not_configured" ? "Beheer is nog niet ingesteld (BINGR_ADMIN_USER / BINGR_ADMIN_PASSWORD)."
        : errText(err);
    } finally { $("loginBtn").disabled = false; }
  };

  // ---- tabs ----
  const loaded = {};
  function showTab(name) {
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("hidden", s.id !== `tab-${name}`));
    try { sessionStorage.setItem(KEY + ".tab", name); } catch { /* */ }
    if (!loaded[name]) { loaded[name] = true; ({ overview: loadStats, users: loadUsers, support: loadTickets, messages: loadAnnouncements, status: loadStatus, downloads: loadDownloads, settings: loadSettings })[name](); }
  }
  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

  function start() {
    $("login").classList.add("hidden"); $("app").classList.remove("hidden");
    Object.keys(loaded).forEach((k) => delete loaded[k]);
    let tab = "overview";
    try { tab = sessionStorage.getItem(KEY + ".tab") || tab; } catch { /* */ }
    // link uit de meldingsmail: https://beheer.bingr.online/#support/1001
    const deep = /^#support(?:\/(\d+))?$/.exec(location.hash);
    if (deep) tab = "support";
    showTab(["overview", "users", "support", "messages", "status", "downloads", "settings"].includes(tab) ? tab : "overview");
    if (deep && deep[1]) openTicket(Number(deep[1]));
    loadSupportCounts();
    clearInterval(supTimer); supTimer = setInterval(() => { if (token() && !document.hidden) loadSupportCounts(); }, 120000);
  }
  let supTimer;
  window.addEventListener("hashchange", () => { const m = /^#support\/(\d+)$/.exec(location.hash); if (m && token()) { showTab("support"); openTicket(Number(m[1])); } });

  // ---- overzicht: instelbaar widget-dashboard ----
  // Zelfde JSON-model als de app Bingr Beheer (README.md, "Dashboard"): {version: 1, widgets: [{id, type, size, hidden, options}]}.
  // Volgorde = volgorde in de lijst. Opslag per browser in localStorage; onbekend of kapot = standaardindeling.
  const DASH_KEY = KEY + ".dashboard", DASH_VERSION = 1, DASH_MAX = 40;
  const SIZE_NAME = { s: "Klein", m: "Middel", l: "Groot" }, SIZE_DIM = { s: "1×1", m: "2×1", l: "2×2" };
  const METRICS = {
    users_total: { label: "Gebruikers", v: (s) => s.total_users, h: (s) => `${nf.format(s.confirmed_users ?? 0)} bevestigd` },
    users_new_7d: { label: "Nieuw (7 dagen)", v: (s) => s.new_users_7d, h: () => "accounts" },
    active_today: { label: "Actief vandaag", v: (s) => s.active_today, h: () => "accounts" },
    active_30d: { label: "Actief (30 dagen)", v: (s) => s.active_30d, h: () => "accounts" },
    devices: { label: "Apparaten", v: (s) => s.devices_total, h: () => "gekoppeld" },
    watching_now: { label: "Kijkt nu", v: (s) => s.watching_now, h: () => "streams", cls: () => "live" },
    blocked: { label: "Geblokkeerd", v: (s) => s.blocked_users, h: () => "accounts", cls: (s) => (s.blocked_users ? "blocked" : ""), filter: "blocked" },
    plan_free: { label: "Gratis", v: (s) => s.plan_free, h: () => "accounts", filter: "free" },
    plan_lifetime: { label: "Lifetime", v: (s) => s.plan_lifetime, h: (s) => (s.plan_custom ? `${nf.format(s.plan_custom)} met eigen limieten` : "accounts"), cls: () => "life", filter: "lifetime" },
    plan_custom: { label: "Eigen limieten", v: (s) => s.plan_custom, h: () => "accounts", filter: "custom" },
    opted_out: { label: "Geen berichtenmail", v: (s) => s.opted_out, h: () => "afgemeld" },
  };
  const SUP_KEYS = ["new", "open", "pending", "resolved", "closed"];
  // opties per type: [soort, toegestane waarden, standaard]; soort enum | bool | set (deelverzameling, niet leeg) | list (vrije tekst, leeg = alles)
  const WTYPES = {
    metric: { name: "Kengetal", desc: "Eén getal: gebruikers, actief, apparaten, kijkers, abonnementen, geblokkeerd…", sizes: ["s", "m"], size: "s",
      opts: { metric: ["enum", Object.keys(METRICS), "users_total"] } },
    daily_chart: { name: "Per dag", desc: "Nieuwe gebruikers, inlogs of actieve accounts per dag, als grafiek of als getal", sizes: ["s", "m", "l"], size: "l",
      opts: { series: ["enum", ["new_users", "signins", "active_users"], "new_users"], days: ["enum", [7, 14, 30], 30], display: ["enum", ["chart", "number"], "chart"] } },
    platforms: { name: "Apparaten per platform", desc: "Actieve apparaten per platform (30 dagen of nu)", sizes: ["m", "l"], size: "l",
      opts: { source: ["enum", ["30d", "live"], "30d"], platforms: ["list", null, []] } },
    versions: { name: "App-versies", desc: "App-versies in gebruik per platform", sizes: ["m", "l"], size: "l",
      opts: { platforms: ["list", null, []] } },
    plans: { name: "Abonnementen", desc: "Gratis, Lifetime en accounts met eigen limieten", sizes: ["s", "m", "l"], size: "m",
      opts: { plans: ["set", ["free", "lifetime", "custom"], ["free", "lifetime", "custom"]] } },
    support: { name: "Supporttickets", desc: "Tickets per status en wat op een reactie wacht", sizes: ["s", "m", "l"], size: "s",
      opts: { statuses: ["set", SUP_KEYS, ["new", "open", "pending"]], display: ["enum", ["number", "list"], "number"] } },
    status: { name: "Servicestatus", desc: "Totaalstatus, storingen en meldingen van de statusmonitor", sizes: ["s", "m", "l"], size: "m",
      opts: { show_incidents: ["bool", null, true], show_notices: ["bool", null, true] } },
    announcements: { name: "Laatste berichten", desc: "De nieuwste berichten aan de apps", sizes: ["m", "l"], size: "l",
      opts: { count: ["enum", [3, 5], 3], only_active: ["bool", null, false] } },
  };
  const OPT_LABEL = {
    metric: ["Getal", Object.fromEntries(Object.entries(METRICS).map(([k, m]) => [k, m.label]))],
    series: ["Gegevens", { new_users: "Nieuwe gebruikers", signins: "Inlogs (of actieve accounts als het inloglogboek leeg is)", active_users: "Accounts met app-activiteit" }],
    days: ["Periode", { 7: "Laatste 7 dagen", 14: "Laatste 14 dagen", 30: "Laatste 30 dagen" }],
    display: ["Weergave", { chart: "Grafiek", number: "Getal", list: "Lijst per status" }],
    source: ["Periode", { "30d": "Gezien in de laatste 30 dagen", live: "Nu actief (laatste 15 minuten)" }],
    platforms: ["Platforms", null],
    plans: ["Abonnementen", { free: "Gratis", lifetime: "Lifetime", custom: "Eigen limieten" }],
    statuses: ["Statussen", { new: "Nieuw", open: "In behandeling", pending: "Wacht op klant", resolved: "Opgelost", closed: "Gesloten" }],
    count: ["Aantal", { 3: "3 berichten", 5: "5 berichten" }],
    only_active: ["Alleen actieve berichten"],
    show_incidents: ["Storingen tonen"],
    show_notices: ["Meldingen tonen (lopend en gepland)"],
  };
  // standaardindeling: lijkt op het vroegere vaste overzicht
  const DASH_DEFAULT = [
    ["users", "metric", "s", { metric: "users_total" }], ["new_7d", "metric", "s", { metric: "users_new_7d" }],
    ["active_today", "metric", "s", { metric: "active_today" }], ["active_30d", "metric", "s", { metric: "active_30d" }],
    ["devices", "metric", "s", { metric: "devices" }], ["watching", "metric", "s", { metric: "watching_now" }],
    ["support", "support", "s", {}], ["blocked", "metric", "s", { metric: "blocked" }],
    ["plan_free", "metric", "s", { metric: "plan_free" }], ["plan_lifetime", "metric", "s", { metric: "plan_lifetime" }],
    ["status", "status", "m", {}],
    ["chart_new", "daily_chart", "l", { series: "new_users" }], ["chart_signins", "daily_chart", "l", { series: "signins" }],
    ["platforms", "platforms", "l", {}], ["versions", "versions", "l", {}],
  ];
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  function normOptions(type, raw) {
    const src = isObj(raw) ? raw : {}, o = {};
    for (const [k, [kind, vals, def]] of Object.entries(WTYPES[type].opts)) {
      const v = src[k];
      if (kind === "enum") o[k] = vals.includes(v) ? v : def;
      else if (kind === "bool") o[k] = typeof v === "boolean" ? v : def;
      else if (kind === "set") { const f = Array.isArray(v) ? vals.filter((x) => v.includes(x)) : []; o[k] = f.length ? f : def.slice(); }
      else o[k] = Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && x && x.length <= 40))].slice(0, 30) : def.slice();
    }
    return o;
  }
  function newId(type, seen) { let i = 1; while (seen.has(`${type}_${i}`)) i++; return `${type}_${i}`; }
  function normWidget(w, seen) {
    if (!isObj(w) || !Object.prototype.hasOwnProperty.call(WTYPES, w.type)) return null;
    const t = WTYPES[w.type];
    const id = typeof w.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(w.id) && !seen.has(w.id) ? w.id : newId(w.type, seen);
    return { id, type: w.type, size: t.sizes.includes(w.size) ? w.size : t.size, hidden: w.hidden === true, options: normOptions(w.type, w.options) };
  }
  function normLayout(raw) {
    if (!isObj(raw) || raw.version !== DASH_VERSION || !Array.isArray(raw.widgets)) return null;
    const seen = new Set(), widgets = [];
    for (const w of raw.widgets) {
      if (widgets.length >= DASH_MAX) break;
      const n = normWidget(w, seen);
      if (n) { seen.add(n.id); widgets.push(n); }
    }
    return widgets.length ? { version: DASH_VERSION, widgets } : null;
  }
  const defaultLayout = () => normLayout({ version: DASH_VERSION, widgets: DASH_DEFAULT.map(([id, type, size, options]) => ({ id, type, size, options })) });
  function loadLayout() {
    try { const l = normLayout(JSON.parse(localStorage.getItem(DASH_KEY) || "null")); if (l) return l; } catch { /* kapot of geen opslag */ }
    return defaultLayout();
  }
  function saveLayout() { try { localStorage.setItem(DASH_KEY, JSON.stringify(dash)); } catch { /* privé-venster: alleen deze sessie */ } }

  let dash = loadLayout(), dashEdit = false, dashLoading = false, dashCharts = [], dragId = null;
  const dd = { stats: null, statsErr: null, status: null, statusErr: null, ann: null, annErr: null };
  const visible = () => dash.widgets.filter((w) => !w.hidden);
  const needs = () => {
    const v = visible();
    return { status: v.some((w) => w.type === "status" || (w.type === "platforms" && w.options.source === "live")), ann: v.some((w) => w.type === "announcements") };
  };

  $("refresh").onclick = () => { loadStats(); loadSupportCounts(); };
  $("dashEdit").onclick = () => setDashEdit(!dashEdit);
  $("dashDone").onclick = () => setDashEdit(false);
  $("dashAdd").onclick = () => openGallery();
  $("dashReset").onclick = () => {
    if (!confirm("De standaardindeling van het overzicht herstellen? Je eigen indeling en instellingen van de widgets gaan verloren.")) return;
    dash = defaultLayout(); saveLayout(); renderDash(); ensureDashData();
    toast("Standaardindeling hersteld."); announce("Standaardindeling hersteld.");
  };
  function setDashEdit(on) {
    dashEdit = on; renderDash();
    (on ? $("dashAdd") : $("dashEdit")).focus();
    announce(on ? "Wijzigmodus aan: verplaats, vergroot, stel in of verberg widgets." : "Wijzigmodus uit.");
  }
  const announce = (t) => { $("dashLive").textContent = ""; setTimeout(() => { $("dashLive").textContent = t; }, 30); };

  async function loadStats() {
    if (dashLoading) return;
    dashLoading = true; $("refresh").disabled = true;
    const n = needs();
    const [s, st, an] = await Promise.allSettled([
      call("stats"), n.status ? call("status", { op: "overview" }) : Promise.resolve(null), n.ann ? call("announcements_list") : Promise.resolve(null),
    ]);
    dashLoading = false; $("refresh").disabled = false;
    if ([s, st, an].some((r) => r.status === "rejected" && r.reason?.code === "auth")) return;
    if (s.status === "fulfilled") { dd.stats = s.value; dd.statsErr = null; smtpOk = !!s.value.smtp; applySmtp(); }
    else { dd.statsErr = errText(s.reason); toast(dd.statsErr, true); }
    if (n.status) { if (st.status === "fulfilled") { dd.status = st.value; dd.statusErr = null; } else dd.statusErr = errText(st.reason); }
    if (n.ann) { if (an.status === "fulfilled") { dd.ann = an.value; dd.annErr = null; } else dd.annErr = errText(an.reason); }
    renderDash();
  }
  // na toevoegen of instellen: ontbrekende gegevens (status, berichten) alsnog ophalen
  function ensureDashData() {
    const n = needs();
    if ((n.status && !dd.status && !dd.statusErr) || (n.ann && !dd.ann && !dd.annErr) || (!dd.stats && !dd.statsErr)) loadStats();
  }
  function dashSupportChanged() {
    if (!$("tab-overview").classList.contains("hidden") && dash.widgets.some((w) => w.type === "support" && !w.hidden)) {
      dash.widgets.filter((w) => w.type === "support" && !w.hidden).forEach((w) => { const el = document.querySelector(`#dash .w[data-id="${w.id}"]`); if (el) fillWidget(w, el); });
    }
  }

  function wTitle(w) {
    const o = w.options, s = dd.stats || {};
    switch (w.type) {
      case "metric": return METRICS[o.metric].label;
      case "daily_chart": return o.series === "new_users" ? "Nieuwe gebruikers per dag" : o.series === "active_users" || s.signins_source === "activity" ? "Actieve accounts per dag" : "Inloggen per dag";
      case "platforms": return o.source === "live" ? "Nu actieve apparaten" : "Actieve apparaten per platform";
      case "versions": return "App-versies in gebruik";
      case "plans": return "Abonnementen";
      case "support": return o.statuses.join() === "new,open,pending" ? "Open tickets" : "Supporttickets";
      case "status": return "Servicestatus";
      case "announcements": return "Laatste berichten";
    }
    return WTYPES[w.type].name;
  }
  const ICO = {
    grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
    hide: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };
  function renderDash() {
    const root = $("dash"), vis = visible();
    dashCharts = [];
    root.classList.toggle("editing", dashEdit);
    $("dashBar").classList.toggle("hidden", !dashEdit);
    $("dashEdit").classList.toggle("hidden", dashEdit);
    $("dashEdit").setAttribute("aria-pressed", String(dashEdit));
    if (!vis.length) {
      root.innerHTML = `<div class="panel dash-empty"><h2>Geen widgets op het overzicht</h2><p class="sub">Voeg widgets toe uit de galerij of herstel de standaardindeling.</p>
        <div class="form-btns"><button type="button" class="btn small" data-empty="add">Widget toevoegen</button><button type="button" class="btn ghost small" data-empty="reset">Standaard herstellen</button></div></div>`;
      root.querySelector('[data-empty="add"]').onclick = () => openGallery();
      root.querySelector('[data-empty="reset"]').onclick = () => $("dashReset").click();
      return;
    }
    root.innerHTML = vis.map((w, i) => {
      const t = WTYPES[w.type], title = esc(wTitle(w));
      const tools = dashEdit ? `<div class="w-edit" role="toolbar" aria-label="${title} aanpassen">
          <span class="w-grip" title="Slepen om te verplaatsen" aria-hidden="true">${ICO.grip}</span>
          <div class="w-sizes" role="group" aria-label="Grootte van ${title}">${t.sizes.map((z) =>
            `<button type="button" data-a="size" data-size="${z}" class="${z === w.size ? "on" : ""}" aria-pressed="${z === w.size}" aria-label="${SIZE_NAME[z]} (${SIZE_DIM[z]})" title="${SIZE_NAME[z]} (${SIZE_DIM[z]})">${z.toUpperCase()}</button>`).join("")}</div>
          <span class="w-sp"></span>
          <button type="button" class="w-ic" data-a="up" aria-label="${title} naar voren" title="Naar voren" ${i === 0 ? "disabled" : ""}>${ICO.up}</button>
          <button type="button" class="w-ic" data-a="down" aria-label="${title} naar achteren" title="Naar achteren" ${i === vis.length - 1 ? "disabled" : ""}>${ICO.down}</button>
          <button type="button" class="w-ic" data-a="opts" aria-label="Gegevens van ${title} instellen" title="Instellen">${ICO.gear}</button>
          <button type="button" class="w-ic" data-a="hide" aria-label="${title} verbergen" title="Verbergen">${ICO.hide}</button>
        </div>` : "";
      return `<article class="w w-${w.size} wt-${w.type}" data-id="${esc(w.id)}" aria-label="${title}"${dashEdit ? ' draggable="true"' : ""}>${tools}<div class="w-body"></div></article>`;
    }).join("");
    root.querySelectorAll(".w").forEach((el) => {
      const w = dash.widgets.find((x) => x.id === el.dataset.id);
      fillWidget(w, el);
      if (dashEdit) wireEdit(w, el);
    });
  }

  // inhoud van één widget
  function fillWidget(w, el) {
    const body = el.querySelector(".w-body"), o = w.options, s = dd.stats, title = esc(wTitle(w));
    el.classList.remove("tile", "alert", "live", "blocked", "life", "clickable");
    const go = (fn) => { if (dashEdit) return; el.classList.add("clickable"); return fn; };
    const head = (sub, more, right = "") => `<div class="w-head"><div class="w-ht"><h2>${title}</h2>${sub && w.size !== "m" ? `<p class="sub">${esc(sub)}</p>` : ""}</div>${right}${more && !dashEdit
      ? `<button type="button" class="w-more" data-go>${esc(more)}</button>` : ""}</div>`;
    const tile = (label, v, h, cls = "") => { el.classList.add("tile", ...cls.split(" ").filter(Boolean)); return `<div class="kpi-in"><div class="l">${label}</div><div class="v">${v}</div><div class="h">${h}</div></div>`; };
    const fail = (msg) => `${head()}<p class="empty">${esc(msg)}</p>`;
    const wait = () => `${head()}<p class="empty">Laden…</p>`;
    let onGo = null;
    const needStats = !["support", "status", "announcements"].includes(w.type) && !(w.type === "platforms" && o.source === "live");
    if (needStats && !s) { body.innerHTML = dd.statsErr ? fail(dd.statsErr) : wait(); return; }
    switch (w.type) {
      case "metric": {
        const m = METRICS[o.metric], v = m.v(s);
        body.innerHTML = v == null ? tile(title, "—", "niet beschikbaar") : tile(title, nf.format(v), esc(m.h(s)), m.cls ? m.cls(s) : "");
        if (m.filter && v != null) onGo = go(() => goUsers(m.filter));
        break;
      }
      case "daily_chart": {
        const days = (s.days || []).slice(-o.days), key = o.series === "active_users" ? "active_users" : o.series;
        const unit = o.series === "new_users" ? "nieuwe gebruikers" : o.series === "signins" && s.signins_source === "audit" ? "inlogs" : "actieve accounts";
        const tot = days.reduce((a, d) => a + (Number(d[key]) || 0), 0), today = days.length ? Number(days[days.length - 1][key]) || 0 : 0;
        const sub = `Laatste ${o.days} dagen${o.series === "signins" ? (s.signins_source === "audit" ? ", uit het inloglogboek" : ", accounts met app-activiteit (inloglogboek leeg)") : ""}`;
        if (o.display === "number" || w.size === "s") {
          const avg = days.length ? tot / days.length : 0;
          body.innerHTML = tile(title, nf.format(tot), `${o.days} dagen · gem. ${avg.toLocaleString("nl-NL", { maximumFractionDigits: 1 })} per dag · vandaag ${nf.format(today)}`);
        } else {
          body.innerHTML = w.size === "l"
            ? `${head(sub)}<div class="w-sum"><b>${nf.format(tot)}</b> <span class="sub">in ${o.days} dagen · vandaag ${nf.format(today)}</span></div><div class="chart"></div>`
            : `${head(null, null, `<div class="w-sum w-sum-r"><b>${nf.format(tot)}</b> <span class="sub">in ${o.days} d</span></div>`)}<div class="chart"></div>`;
          const c = body.querySelector(".chart"), data = days.map((d) => ({ x: d.day, y: Number(d[key]) || 0 })), H = w.size === "l" ? 190 : 84;
          const draw = () => barChart(c, data, unit, H);
          dashCharts.push(draw); draw();
        }
        break;
      }
      case "platforms": case "versions": {
        const live = w.type === "platforms" && o.source === "live";
        if (live && !dd.status) { body.innerHTML = dd.statusErr ? fail(dd.statusErr) : wait(); return; }
        const src = w.type === "versions" ? s.versions || [] : live ? dd.status.devices || [] : s.platforms || [];
        const rows = src.filter((p) => !o.platforms.length || o.platforms.includes(p.platform));
        const sub = (live ? "Gezien in de laatste 15 minuten" : w.type === "versions" ? "Per platform, laatste 30 dagen" : "Gezien in de laatste 30 dagen") + (o.platforms.length ? ` · ${o.platforms.map(pname).join(", ")}` : "");
        body.innerHTML = `${head(sub)}<div class="hbars"></div>`;
        hbars(body.querySelector(".hbars"), rows.map((p) => ({ n: p.devices,
          label: w.type === "versions" ? `${esc(p.app_version === "?" ? "onbekend" : p.app_version)} <small>${esc(pname(p.platform))}</small>` : esc(pname(p.platform)) })), w.size === "l" ? 7 : 3);
        break;
      }
      case "plans": {
        if (s.plan_lifetime == null) { body.innerHTML = fail("Niet beschikbaar (ouder databaseschema)."); break; }
        const P = { free: ["Gratis", s.plan_free], lifetime: ["Lifetime", s.plan_lifetime], custom: ["Eigen limieten", s.plan_custom] };
        if (w.size === "s") {
          const [first, ...rest] = o.plans;
          body.innerHTML = tile(`${title} · ${P[first][0]}`, nf.format(P[first][1] ?? 0), esc(rest.map((k) => `${nf.format(P[k][1] ?? 0)} ${P[k][0]}`).join(" · ") || "accounts"), first === "lifetime" ? "life" : "");
          onGo = go(() => goUsers(first));
        } else {
          body.innerHTML = `${head("Accounts per abonnement", "Gebruikers")}<div class="w-rows${w.size === "m" ? " w-cols" : ""}">${o.plans.map((k) =>
            `<button type="button" class="w-row" data-plan="${k}"><span>${esc(P[k][0])}</span><b class="${k === "lifetime" ? "gold" : ""}">${nf.format(P[k][1] ?? 0)}</b></button>`).join("")}</div>`;
          body.querySelectorAll("[data-plan]").forEach((b) => { b.disabled = dashEdit; b.onclick = () => goUsers(b.dataset.plan); });
          const more = body.querySelector("[data-go]"); if (more) more.onclick = () => goUsers("");
        }
        break;
      }
      case "support": {
        const c = supCounts, u = c?.unread || 0;
        const sum = c ? o.statuses.reduce((a, k) => a + (c[k] || 0), 0) : null;
        if (o.display === "number" || w.size === "s") {
          body.innerHTML = tile(title, sum == null ? "—" : nf.format(sum), esc(supCountsText()), `sup${u ? " alert" : ""}`);
        } else {
          const max = Math.max(1, ...o.statuses.map((k) => c?.[k] || 0));
          body.innerHTML = `${head(u ? `${nf.format(u)} wacht${u === 1 ? "" : "en"} op reactie` : c ? `${nf.format(c.last_7d || 0)} nieuw in 7 dagen` : "", "Support")}
            ${c ? `<div class="w-rows">${o.statuses.slice(0, w.size === "m" ? 3 : 5).map((k) => `<button type="button" class="w-row" data-st="${k}"><span>${supBadge(k)}</span><span class="w-bar"><i data-w="${((c[k] || 0) / max * 100).toFixed(1)}"></i></span><b>${nf.format(c[k] || 0)}</b></button>`).join("")}</div>`
              : '<p class="empty">Laden…</p>'}`;
          body.querySelectorAll("i[data-w]").forEach((b) => { b.style.width = `${Math.max(2, Number(b.dataset.w))}%`; });
          body.querySelectorAll("[data-st]").forEach((b) => { b.disabled = dashEdit; b.onclick = () => goSupport(b.dataset.st); });
          const more = body.querySelector("[data-go]"); if (more) more.onclick = () => goSupport(null, o.statuses);
          if (u) el.classList.add("alert");
        }
        if (o.display === "number" || w.size === "s") onGo = go(() => goSupport(null, o.statuses));
        break;
      }
      case "status": {
        if (!dd.status) { body.innerHTML = dd.statusErr ? fail(dd.statusErr) : wait(); return; }
        const d = dd.status, ov = d.overall || { state: "up" };
        const lvl = ov.level || ({ down: "major", degraded: "degraded" })[ov.state] || "operational", cls = LVL_CLASS[lvl] || "up";
        const txt = { major: "Grote storing", partial: "Gedeeltelijke storing", degraded: "Verminderd", maintenance: "Onderhoud", operational: "Alle systemen werken" }[lvl];
        const all = (d.groups || []).flatMap((g) => g.monitors || []), nm = (id) => all.find((m) => m.id === id)?.name?.nl || id;
        const affected = (ov[lvl] || ov[ov.state] || []).map(nm).join(", ");
        const openInc = (d.incidents || []).filter((i) => !i.ended_at);
        const notices = (d.all_notices || []).filter((n) => (n.kind === "incident" && n.status !== "resolved") || ["in_progress", "scheduled"].includes(n.status));
        const last = d.scheduler?.last_run_at;
        let html = `${head(null, w.size === "s" ? null : "Status")}<div class="w-st ${cls}"><span class="st-dot ${cls}"></span><div><b>${esc(txt)}</b>${affected && lvl !== "operational" ? `<div class="sub">${esc(affected)}</div>` : ""}
          <div class="sub">Laatste controle ${esc(last ? ago(last) : "nooit")}</div></div></div>`;
        if (w.size !== "s") {
          const facts = [];
          if (o.show_incidents) facts.push(`${nf.format(openInc.length)} open ${openInc.length === 1 ? "storing" : "storingen"}`);
          if (o.show_notices) facts.push(`${nf.format(notices.length)} ${notices.length === 1 ? "melding" : "meldingen"}`);
          if (facts.length) html += `<p class="sub w-facts">${esc(facts.join(" · "))}</p>`;
        }
        if (w.size === "l") {
          const items = [
            ...(o.show_notices ? notices.slice(0, 4).map((n) => `<li><span class="nt-bar ${ntTone(n)}"></span><span class="w-li"><b>${esc(n.title?.nl || "")}</b><span class="sub">${esc(NST[n.status] || n.status)}</span></span></li>`) : []),
            ...(o.show_incidents ? openInc.slice(0, 4).map((i) => `<li><span class="st-dot down"></span><span class="w-li"><b>${esc(i.name?.nl || i.monitor_id)}</b><span class="sub">${esc(i.cause || "onbekende oorzaak")} · sinds ${esc(ago(i.started_at))}</span></span></li>`) : []),
          ];
          html += items.length ? `<ul class="w-list">${items.join("")}</ul>` : (o.show_incidents || o.show_notices ? '<p class="empty">Geen storingen of meldingen.</p>' : "");
        }
        body.innerHTML = html;
        const more = body.querySelector("[data-go]"); if (more) more.onclick = () => showTab("status");
        if (w.size === "s") onGo = go(() => showTab("status"));
        break;
      }
      case "announcements": {
        if (!dd.ann) { body.innerHTML = dd.annErr ? fail(dd.annErr) : wait(); return; }
        const items = (dd.ann.items || []).filter((a) => !o.only_active || a.active).slice(0, w.size === "m" ? 2 : o.count);
        body.innerHTML = `${head(o.only_active ? "Actieve berichten" : "Nieuwste eerst", "Berichten")}${items.length ? `<ul class="w-list">${items.map((a) =>
          `<li><span class="w-li"><b>${esc(a.title_nl)}</b><span class="sub"><span class="badge ${a.active ? "on" : "off"}">${a.active ? "Actief" : "Verlopen"}</span> ${esc(fmtDate(a.created_at))}</span></span></li>`).join("")}</ul>`
          : `<p class="empty">${o.only_active ? "Geen actieve berichten." : "Nog geen berichten."}</p>`}`;
        const more = body.querySelector("[data-go]"); if (more) more.onclick = () => showTab("messages");
        break;
      }
    }
    // hele kaart klikbaar (alleen buiten de wijzigmodus): via een knop over de kaart, zodat het ook met het toetsenbord werkt
    if (onGo) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "w-hit"; b.setAttribute("aria-label", `${wTitle(w)}: bekijken`);
      b.onclick = onGo; body.appendChild(b);
    }
  }
  function goUsers(f) { userFilter = f; page = 0; const was = loaded.users; showTab("users"); if (was) loadUsers(); }
  function goSupport(st, statuses) {
    const f = st || (statuses && statuses.join() === "new,open,pending" ? "active" : statuses && statuses.length === 1 ? statuses[0] : "all");
    supFilter = f; supPageNo = 0;
    try { sessionStorage.setItem(KEY + ".supFilter", supFilter); } catch { /* */ }
    const was = loaded.support; showTab("support"); if (was) loadTickets(); else renderSupFilters();
  }

  // ---- wijzigmodus: grootte, volgorde (slepen of knoppen), instellen, verbergen ----
  function moveWidget(id, delta) {
    const vis = visible(), i = vis.findIndex((w) => w.id === id), j = i + delta;
    if (i < 0 || j < 0 || j >= vis.length) return false;
    const from = dash.widgets.indexOf(vis[i]), to = dash.widgets.indexOf(vis[j]);
    const [w] = dash.widgets.splice(from, 1);
    dash.widgets.splice(to, 0, w);
    return true;
  }
  function placeWidget(id, targetId, after) {
    if (id === targetId) return false;
    const from = dash.widgets.findIndex((w) => w.id === id);
    if (from < 0) return false;
    const [w] = dash.widgets.splice(from, 1);
    let to = dash.widgets.findIndex((x) => x.id === targetId);
    if (to < 0) { dash.widgets.splice(from, 0, w); return false; }
    dash.widgets.splice(after ? to + 1 : to, 0, w);
    return true;
  }
  const posText = (id) => { const vis = visible(); return `positie ${vis.findIndex((w) => w.id === id) + 1} van ${vis.length}`; };
  function focusIn(id, sel) { const el = document.querySelector(`#dash .w[data-id="${id}"] ${sel}`); if (el && !el.disabled) el.focus(); else document.querySelector(`#dash .w[data-id="${id}"] .w-edit button:not(:disabled)`)?.focus(); }
  function wireEdit(w, el) {
    el.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => {
      const a = b.dataset.a, title = wTitle(w);
      if (a === "size") { w.size = b.dataset.size; saveLayout(); renderDash(); focusIn(w.id, `[data-size="${w.size}"]`); announce(`${title}: ${SIZE_NAME[w.size].toLowerCase()}`); }
      else if (a === "up" || a === "down") {
        if (moveWidget(w.id, a === "up" ? -1 : 1)) { saveLayout(); renderDash(); focusIn(w.id, `[data-a="${a}"]`); announce(`${title} staat nu op ${posText(w.id)}`); }
      } else if (a === "opts") openWidgetSettings(w);
      else if (a === "hide") {
        const vis = visible(), i = vis.indexOf(w), next = vis[i + 1] || vis[i - 1];
        w.hidden = true; saveLayout(); renderDash();
        if (next) focusIn(next.id, '[data-a="hide"]'); else $("dashAdd").focus();
        toast(`${title} verborgen. Terugzetten kan via Widget toevoegen.`); announce(`${title} verborgen`);
      }
    }));
    // slepen met de muis (HTML5 drag and drop); toetsenbord: de knoppen naar voren / naar achteren
    el.addEventListener("dragstart", (e) => { dragId = w.id; el.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", w.id); } catch { /* */ } });
    el.addEventListener("dragend", () => { dragId = null; document.querySelectorAll("#dash .w").forEach((x) => x.classList.remove("dragging", "drop-before", "drop-after")); });
    el.addEventListener("dragover", (e) => {
      if (!dragId || dragId === w.id) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      const r = el.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
      el.classList.toggle("drop-after", after); el.classList.toggle("drop-before", !after);
    });
    el.addEventListener("dragleave", () => el.classList.remove("drop-before", "drop-after"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      const id = dragId, after = el.classList.contains("drop-after");
      if (id && placeWidget(id, w.id, after)) { saveLayout(); renderDash(); announce(`${wTitle(dash.widgets.find((x) => x.id === id))} staat nu op ${posText(id)}`); }
    });
  }

  // galerij: verborgen widgets terugzetten of nieuwe toevoegen
  function openGallery() {
    const hidden = dash.widgets.filter((w) => w.hidden), full = dash.widgets.length >= DASH_MAX;
    $("drawerBody").innerHTML = `<h2 id="dTitle">Widget toevoegen</h2>
      <p class="sub">Kies een widget voor het overzicht. Daarna kun je grootte, plaats en getoonde gegevens instellen.</p>
      ${hidden.length ? `<h3>Verborgen</h3><div class="wg-list">${hidden.map((w) => `<div class="wg"><div><b>${esc(wTitle(w))}</b><div class="sub">${esc(WTYPES[w.type].name)} · ${SIZE_NAME[w.size].toLowerCase()}</div></div>
        <div class="wg-btns"><button type="button" class="btn small" data-show="${esc(w.id)}" aria-label="${esc(wTitle(w))} tonen">Tonen</button><button type="button" class="btn danger small" data-del="${esc(w.id)}" aria-label="${esc(wTitle(w))} verwijderen">Verwijderen</button></div></div>`).join("")}</div>` : ""}
      <h3>Galerij</h3>${full ? `<p class="sub">Maximaal ${DASH_MAX} widgets; verwijder eerst een verborgen widget.</p>` : ""}
      <div class="wg-list">${Object.entries(WTYPES).map(([k, t]) => `<div class="wg"><div><b>${esc(t.name)}</b><div class="sub">${esc(t.desc)}</div></div>
        <div class="wg-btns"><button type="button" class="btn ghost small" data-add="${k}" aria-label="${esc(t.name)} toevoegen" ${full ? "disabled" : ""}>Toevoegen</button></div></div>`).join("")}</div>`;
    openDrawer();
    $("drawerBody").querySelectorAll("[data-show]").forEach((b) => (b.onclick = () => {
      const w = dash.widgets.find((x) => x.id === b.dataset.show); if (!w) return;
      w.hidden = false; saveLayout(); closeDrawer(); renderDash(); ensureDashData(); focusIn(w.id, '[data-a="opts"]'); toast(`${wTitle(w)} staat weer op het overzicht.`);
    }));
    $("drawerBody").querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => {
      dash.widgets = dash.widgets.filter((x) => x.id !== b.dataset.del);
      if (!dash.widgets.length) dash = defaultLayout();
      saveLayout(); openGallery();
    }));
    $("drawerBody").querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => {
      const seen = new Set(dash.widgets.map((w) => w.id));
      const w = normWidget({ id: newId(b.dataset.add, seen), type: b.dataset.add }, seen);
      dash.widgets.push(w); saveLayout(); closeDrawer();
      if (!dashEdit) dashEdit = true;
      renderDash(); ensureDashData();
      document.querySelector(`#dash .w[data-id="${w.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      focusIn(w.id, '[data-a="opts"]'); toast(`${wTitle(w)} toegevoegd.`);
    }));
    $("drawerBody").querySelector("button")?.focus();
  }

  // instellingen van één widget (lade): grootte en de opties van het type
  function openWidgetSettings(w) {
    const t = WTYPES[w.type];
    const known = [...new Set([...(dd.stats?.platforms || []), ...(dd.stats?.versions || []), ...(dd.status?.devices || [])].map((p) => p.platform).filter(Boolean).concat(w.options.platforms || []))];
    const field = (k, [kind, vals, def]) => {
      const [label, names] = OPT_LABEL[k], cur = w.options[k];
      if (kind === "bool") return `<label class="switch"><input type="checkbox" data-o="${k}" ${cur ? "checked" : ""}><span class="track"></span><span>${esc(label)}</span></label>`;
      if (kind === "enum") {
        return `<label>${esc(label)}<select data-o="${k}">${vals.map((v) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(names[v] ?? v)}</option>`).join("")}</select></label>`;
      }
      const list = kind === "set" ? vals : known, labelOf = (v) => (kind === "set" ? names[v] : pname(v));
      return `<fieldset class="wo-set" data-o="${k}" data-kind="${kind}"><legend>${esc(label)}${kind === "list" ? ' <span class="sub">niets aangevinkt = alle platforms</span>' : ' <span class="sub">minstens één</span>'}</legend>
        ${list.length ? list.map((v) => `<label class="wo-chk"><input type="checkbox" value="${esc(v)}" ${cur.includes(v) ? "checked" : ""}><span>${esc(labelOf(v))}</span></label>`).join("") : '<p class="sub">Nog geen platforms bekend.</p>'}</fieldset>`;
    };
    $("drawerBody").innerHTML = `<h2 id="dTitle">${esc(wTitle(w))}</h2><p class="sub">${esc(t.name)}: ${esc(t.desc)}</p>
      <form id="woForm" class="wo-form" novalidate>
        <fieldset class="wo-size"><legend>Grootte</legend><div class="seg" role="radiogroup" aria-label="Grootte">${t.sizes.map((z) =>
          `<button type="button" role="radio" data-size="${z}" class="${z === w.size ? "on" : ""}" aria-checked="${z === w.size}">${SIZE_NAME[z]} <span class="sub">${SIZE_DIM[z]}</span></button>`).join("")}</div></fieldset>
        ${Object.entries(t.opts).map(([k, spec]) => field(k, spec)).join("")}
        <div id="woErr" class="err" role="alert"></div>
        <div class="form-btns"><button class="btn" type="submit">Opslaan</button><button id="woDefault" class="btn ghost" type="button">Standaard voor deze widget</button></div>
      </form>`;
    openDrawer();
    let size = w.size;
    const segBtns = [...$("drawerBody").querySelectorAll(".wo-size [data-size]")];
    segBtns.forEach((b) => (b.onclick = () => { size = b.dataset.size; segBtns.forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", String(x === b)); }); }));
    $("woDefault").onclick = () => {
      Object.assign(w, { size: t.size, options: normOptions(w.type, {}) });
      saveLayout(); closeDrawer(); renderDash(); ensureDashData(); toast("Standaardinstellingen van de widget hersteld.");
    };
    $("woForm").onsubmit = (e) => {
      e.preventDefault();
      const raw = {};
      $("woForm").querySelectorAll("select[data-o]").forEach((s) => { const spec = t.opts[s.dataset.o]; raw[s.dataset.o] = spec[1].find((v) => String(v) === s.value); });
      $("woForm").querySelectorAll("input[type=checkbox][data-o]").forEach((c) => { raw[c.dataset.o] = c.checked; });
      for (const fs of $("woForm").querySelectorAll("fieldset[data-o]")) {
        const vals = [...fs.querySelectorAll("input:checked")].map((c) => c.value);
        if (fs.dataset.kind === "set" && !vals.length) { $("woErr").textContent = `Kies minstens één bij ${OPT_LABEL[fs.dataset.o][0].toLowerCase()}.`; return; }
        raw[fs.dataset.o] = vals;
      }
      w.size = t.sizes.includes(size) ? size : t.size;
      w.options = normOptions(w.type, raw);
      saveLayout(); closeDrawer(); renderDash(); ensureDashData();
      focusIn(w.id, '[data-a="opts"]'); toast("Widget opgeslagen.");
    };
    segBtns.find((b) => b.classList.contains("on"))?.focus();
  }

  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (!$("tab-overview").classList.contains("hidden")) dashCharts.forEach((f) => f()); }, 150); });
  // Staafdiagram (één reeks) met hover-tooltip; inline SVG.
  function barChart(el, data, unit, H = 190) {
    if (!data.length) { el.innerHTML = '<p class="empty">Nog geen gegevens.</p>'; return; }
    const W = Math.max(240, Math.round(el.clientWidth || 560)), L = 28, R = 4, T = 8, B = 22;
    const every = data.length <= 7 ? 1 : data.length <= 14 ? 2 : 7;
    const max = Math.max(1, ...data.map((d) => d.y));
    const step = niceStep(max);
    const top = Math.ceil(max / step) * step;
    const iw = W - L - R, ih = H - T - B, bw = iw / data.length, gap = Math.min(2, bw * 0.25);
    const y = (v) => T + ih - (v / top) * ih;
    let g = '<g class="grid axis">';
    for (let v = 0; v <= top; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
    g += "</g>";
    let bars = "", ticks = '<g class="axis">';
    data.forEach((d, i) => {
      const x = L + i * bw + gap / 2, w = Math.max(1, bw - gap), h = Math.max(d.y ? 2 : 1.5, (d.y / top) * ih);
      const r = Math.min(4, w / 2, h);
      // afgeronde bovenkant, platte voet op de basislijn
      const path = `M${x},${T + ih} V${T + ih - h + r} Q${x},${T + ih - h} ${x + r},${T + ih - h} H${x + w - r} Q${x + w},${T + ih - h} ${x + w},${T + ih - h + r} V${T + ih} Z`;
      bars += `<g data-i="${i}"><path class="bar ${d.y ? "" : "zero"}" d="${path}" fill="${d.y ? "var(--red)" : "#ffffff1f"}"/><rect class="hit" x="${L + i * bw}" y="${T}" width="${bw}" height="${ih}"/></g>`;
      if ((data.length - 1 - i) % every === 0) ticks += `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${shortDay(d.x)}</text>`;
    });
    ticks += "</g>";
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(unit)} per dag">${g}${bars}${ticks}</svg><div class="tip hidden"></div>`;
    const svg = el.querySelector("svg"), tip = el.querySelector(".tip");
    svg.querySelectorAll("g[data-i]").forEach((gr) => {
      const i = Number(gr.dataset.i), d = data[i];
      const show = () => {
        svg.querySelectorAll(".bar").forEach((b) => b.setAttribute("fill", b.classList.contains("zero") ? "#ffffff1f" : "var(--red)"));
        const b = gr.querySelector(".bar"); if (d.y) b.setAttribute("fill", "var(--red-hi)");
        const sx = svg.getBoundingClientRect().width / W;
        tip.innerHTML = `<b>${nf.format(d.y)}</b> ${esc(unit)}<br><span class="sub">${esc(longDay(d.x))}</span>`;
        tip.style.left = `${(L + (i + 0.5) * bw) * sx}px`; tip.style.top = `${y(d.y) * sx}px`;
        tip.classList.remove("hidden");
      };
      gr.addEventListener("mouseenter", show); gr.addEventListener("touchstart", show, { passive: true });
    });
    svg.addEventListener("mouseleave", () => { tip.classList.add("hidden"); svg.querySelectorAll(".bar").forEach((b) => b.setAttribute("fill", b.classList.contains("zero") ? "#ffffff1f" : "var(--red)")); });
  }
  function niceStep(max) {
    const raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) if (m * p >= raw) return Math.max(1, m * p);
    return Math.max(1, 10 * p);
  }
  const shortDay = (d) => new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  const longDay = (d) => new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
  function hbars(el, rows, limit = 14) {
    if (!rows.length) { el.innerHTML = '<p class="empty">Nog geen gegevens.</p>'; return; }
    const max = Math.max(...rows.map((r) => r.n), 1);
    el.innerHTML = rows.slice(0, limit).map((r) =>
      `<div class="hbar"><span class="n">${r.label}</span><span class="t"><span data-w="${Math.max(2, (r.n / max) * 100).toFixed(1)}"></span></span><span class="c">${nf.format(r.n)}</span></div>`).join("") +
      (rows.length > limit ? `<p class="sub hbar-more">+ ${rows.length - limit} meer</p>` : "");
    // build 97: breedte via de CSSOM in plaats van een style-attribuut (Content-Security-Policy: style-src 'self')
    el.querySelectorAll("span[data-w]").forEach((b) => { b.style.width = `${b.dataset.w}%`; });
  }

  // ---- gebruikers ----
  let page = 0, total = 0, searchTimer, userFilter = "", blockedTotal = null, freeTotal = null, lifetimeTotal = null;
  const PAGE = 25;
  $("search").oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page = 0; loadUsers(); }, 300); };
  $("prev").onclick = () => { if (page > 0) { page--; loadUsers(); } };
  $("next").onclick = () => { if ((page + 1) * PAGE < total) { page++; loadUsers(); } };
  async function loadUsers() {
    let r;
    try { r = await call("users", { q: $("search").value.trim(), page, page_size: PAGE, ...(userFilter ? { filter: userFilter } : {}) }); } catch (e) { if (e.code !== "auth") toast(errText(e), true); return; }
    total = r.total || 0;
    if (r.blocked_total != null) blockedTotal = r.blocked_total;
    if (r.free_total != null) freeTotal = r.free_total;
    if (r.lifetime_total != null) lifetimeTotal = r.lifetime_total;
    renderUserFilters();
    $("userCount").textContent = `${nf.format(total)} ${total === 1 ? "account" : "accounts"}`;
    $("userRows").innerHTML = (r.items || []).map((u) => `<tr data-id="${esc(u.id)}" tabindex="0"${u.blocked ? ' class="is-blocked"' : ""}>
      <td class="em">${esc(u.email)}${u.confirmed ? "" : ' <span class="chip warn">onbevestigd</span>'}${u.blocked
        ? ` <span class="chip bad" title="${esc(u.blocked.until ? `Geblokkeerd tot ${fmtDateTime(u.blocked.until)}` : "Geblokkeerd voor onbepaalde tijd")}">Geblokkeerd</span>` : ""} ${planChip(u.plan)}</td>
      <td data-l="Aangemaakt">${esc(fmtDate(u.created_at))}</td>
      <td data-l="Laatst ingelogd">${esc(ago(u.last_sign_in_at))}</td>
      <td data-l="Apparaten">${nf.format(u.device_count || 0)} ${(u.platforms || []).map((p) => `<span class="chip">${esc(pname(p))}</span>`).join("")}</td>
      <td data-l="Profielen">${nf.format(u.profile_count || 0)}</td>
      <td data-l="Versies">${(u.app_versions || []).map((v) => `<span class="chip">${esc(v)}</span>`).join("") || '<span class="sub">—</span>'}</td>
    </tr>`).join("") || `<tr><td colspan="6" class="empty">${({ blocked: "Geen geblokkeerde accounts.", free: "Geen Gratis-accounts gevonden.", lifetime: "Geen Lifetime-accounts gevonden.", custom: "Geen accounts met eigen limieten." })[userFilter] || "Geen accounts gevonden."}</td></tr>`;
    $("userRows").querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.onclick = () => openUser(tr.dataset.id);
      tr.onkeydown = (e) => { if (e.key === "Enter") openUser(tr.dataset.id); };
    });
    const pages = Math.max(1, Math.ceil(total / PAGE));
    $("pageInfo").textContent = `Pagina ${page + 1} van ${pages}`;
    $("prev").disabled = page === 0; $("next").disabled = page + 1 >= pages;
  }

  function renderUserFilters() {
    const f = [["", "Alle accounts", null], ["free", "Gratis", freeTotal], ["lifetime", "Lifetime", lifetimeTotal], ["custom", "Eigen limieten", null], ["blocked", "Geblokkeerd", blockedTotal]];
    $("userFilters").innerHTML = f.map(([k, l, n]) => `<button type="button" data-f="${k}" class="${k === userFilter ? "on" : ""}" aria-pressed="${k === userFilter}">${esc(l)}${n != null ? ` <span class="n">${nf.format(n)}</span>` : ""}</button>`).join("");
    $("userFilters").querySelectorAll("button").forEach((b) => (b.onclick = () => { userFilter = b.dataset.f; page = 0; loadUsers(); }));
  }

  const ICON = {
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    tablet: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M11 18h2"/>',
    mac: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M2 20h20"/>',
    tv: '<rect x="2" y="5" width="20" height="13" rx="2"/><path d="M8 21h8"/>',
    // Apple TV: het appletv-symbool uit de apps (gevuld)
    appletv: '<g fill="currentColor" stroke="none" transform="translate(2.25 2.28) scale(1.0)"><path d="M5.20687 19.4314L14.2907 19.4314C15.949 19.4314 17.3557 19.2815 18.3579 18.2793C19.3476 17.2792 19.4976 15.8974 19.4976 14.2246L19.4976 5.22355C19.4976 3.55067 19.3476 2.1668 18.3579 1.16882C17.3536 0.176964 15.949 0.0166814 14.2907 0.0166814L5.18577 0.0166814C3.55067 0.0166814 2.14188 0.179074 1.14179 1.17093C0.149932 2.17102 0 3.55489 0 5.1921L0 14.2246C0 15.8974 0.147822 17.2917 1.13968 18.2793C2.14188 19.2815 3.5361 19.4314 5.20687 19.4314ZM4.93695 17.8607C3.93656 17.8607 2.87758 17.7212 2.2877 17.1313C1.69781 16.5414 1.57069 15.497 1.57069 14.4945L1.57069 4.98508C1.57069 3.95535 1.69781 2.90461 2.28559 2.31473C2.87547 1.72274 3.94078 1.58737 4.9684 1.58737L14.5606 1.58737C15.561 1.58737 16.6179 1.72696 17.2078 2.31684C17.7997 2.90672 17.9269 3.95113 17.9269 4.95363L17.9269 14.4945C17.9269 15.497 17.7976 16.5414 17.2078 17.1313C16.6179 17.7233 15.561 17.8607 14.5606 17.8607Z"/><path d="M4.85163 12.6004C5.26284 12.6004 5.4373 12.3138 5.94819 12.3138C6.47155 12.3138 6.59616 12.6004 7.04476 12.6004C7.49335 12.6004 7.79241 12.1768 8.09148 11.7655C8.39054 11.3045 8.54007 10.8434 8.54007 10.8185C8.52761 10.8185 7.64288 10.4571 7.64288 9.46027C7.64288 8.61293 8.32823 8.22664 8.36562 8.18925C7.92948 7.56621 7.23167 7.54128 7.04476 7.54128C6.53386 7.54128 6.12265 7.82789 5.86097 7.82789C5.58683 7.82789 5.22546 7.56621 4.77687 7.56621C3.95444 7.56621 3.1071 8.2391 3.1071 9.53503C3.1071 10.345 3.40616 11.1923 3.79245 11.7406C4.14136 12.2141 4.42796 12.6004 4.85163 12.6004ZM5.89835 7.45406C6.5214 7.45406 7.16937 6.78117 7.15691 6.04597C7.16937 6.00859 7.15691 5.95875 7.14444 5.92136C6.48402 5.94628 5.81112 6.60671 5.81112 7.32945C5.81112 7.36683 5.81112 7.42914 5.82359 7.4416C5.83605 7.45406 5.86097 7.45406 5.89835 7.45406ZM11.0073 12.5755C11.2192 12.5755 11.4435 12.563 11.5556 12.5381L11.5805 12.5257L11.5805 11.7157L11.5432 11.7157C11.4809 11.7282 11.3313 11.7406 11.2316 11.7406C10.8578 11.7406 10.6958 11.5662 10.6958 11.1799L10.6958 8.60046L11.593 8.60046L11.593 7.77804L10.6958 7.77804L10.6958 6.65656L9.68648 6.65656L9.68648 7.77804L9.00112 7.77804L9.00112 8.60046L9.68648 8.60046L9.68648 11.292C9.68648 12.2017 10.0728 12.5755 11.0073 12.5755ZM13.6864 12.5381L14.7332 12.5381L16.4029 7.77804L15.3562 7.77804L14.2223 11.4914L13.0759 7.77804L11.9917 7.77804Z"/></g>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  };
  function icon(p) {
    const k = /^(apple ?tv|tvos)$/i.test(p || "") ? "appletv" : /iphone|^android$/i.test(p) ? "phone" : /ipad|tablet/i.test(p) ? "tablet" : /mac/i.test(p) ? "mac" : p === "browser" ? "globe" : "tv";
    return `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`;
  }
  // einde van een blokkade als tekst ("tot 21 okt. 2026 14:00" of "voor onbepaalde tijd")
  const untilText = (v) => (v ? `tot ${fmtDateTime(v)}` : "voor onbepaalde tijd");
  const LIFTED = { beheer: "opgeheven", verlopen: "verlopen", vervangen: "vervangen door een nieuwe blokkade" };
  const PRESETS = [["1", "1 dag"], ["7", "7 dagen"], ["30", "30 dagen"], ["0", "Onbepaald"], ["custom", "Eigen datum"]];

  async function openUser(id) {
    $("drawerBody").innerHTML = '<p class="sub">Laden…</p>';
    openDrawer();
    let u;
    try { u = await call("user_detail", { id }); } catch (e) { if (e.code !== "auth") $("drawerBody").innerHTML = `<p class="err">${esc(errText(e))}</p>`; return; }
    const b = u.block, hist = (u.blocks || []).filter((x) => !b || x.id !== b.id);
    const mailHint = smtpOk ? "" : '<p class="sub">E-mail is niet ingesteld op de server; er gaat geen mail uit.</p>';
    $("drawerBody").innerHTML = `
      <h2 id="dTitle">${esc(u.email)}${b ? ' <span class="chip bad">Geblokkeerd</span>' : ""}</h2>
      ${b ? `<div class="block-banner" role="status">
        <div class="bb-h"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>
          <b>Geblokkeerd ${esc(untilText(b.until))}</b></div>
        <div class="bb-r">${esc(b.reason)}</div>
        <div class="bb-m">Sinds ${esc(fmtDateTime(b.created_at))} · ${b.notified ? "klant gemaild" : "klant niet gemaild"}</div>
        <label class="switch"><input id="ubNotify" type="checkbox" ${smtpOk ? "checked" : "disabled"}><span class="track"></span><span>Klant mailen dat het account weer actief is</span></label>
        <div class="form-btns"><button id="ubBtn" class="btn">Blokkade opheffen</button></div>
        <div id="ubErr" class="err" role="alert"></div>
      </div>` : ""}
      <dl class="dl">
        <dt>Aangemaakt</dt><dd>${esc(fmtDateTime(u.created_at))}</dd>
        <dt>Laatst ingelogd</dt><dd>${esc(u.last_sign_in_at ? fmtDateTime(u.last_sign_in_at) : "nooit")}</dd>
        <dt>Bevestigd</dt><dd>${u.confirmed ? "Ja" : "Nee"}</dd>
        <dt>Taal</dt><dd>${esc(u.lang || "—")}</dd>
        <dt>Profielen</dt><dd>${nf.format(u.profile_count || 0)}</dd>
        <dt>Actief (30 d)</dt><dd>${nf.format(u.active_days_30d || 0)} dagen</dd>
        <dt>Kijkt nu</dt><dd>${nf.format(u.watching_now || 0)}</dd>
        <dt>Berichten per e-mail</dt><dd>${u.email_opt_out ? "Afgemeld" : "Aan"}</dd>
      </dl>
      ${planSection(u)}
      <h3>Apparaten (${(u.devices || []).length})</h3>
      ${(u.devices || []).map((d) => `<div class="dev"><div class="ic">${icon(d.platform)}</div><div>
        <div class="nm">${esc(d.name || pname(d.platform))}</div>
        <div class="meta">${esc(pname(d.platform))}${d.app_version ? " · Bingr " + esc(d.app_version) : ""}${d.os_version ? " · " + esc(d.os_version) : ""}</div>
        <div class="meta">Laatst gezien ${esc(ago(d.last_seen_at))} · gekoppeld ${esc(fmtDate(d.created_at))}</div></div></div>`).join("") || '<p class="empty">Geen apparaten.</p>'}
      <div class="actions">
        <button id="resetBtn" class="btn ghost">Stuur wachtwoord-reset</button>
        ${b ? "" : '<button id="blockOpen" class="btn ghost" aria-expanded="false" aria-controls="blockForm">Blokkeren…</button>'}
        <p class="sub">De gebruiker krijgt de standaard reset-mail van Bingr en kiest zelf een nieuw wachtwoord. Je ziet of wijzigt nooit een wachtwoord.</p>
      </div>
      ${b ? "" : `<form id="blockForm" class="block-form hidden" novalidate>
        <h3>Account blokkeren</h3>
        <p class="sub">De klant kan niet meer inloggen en wordt op alle apparaten uitgelogd. De reden en de einddatum staan in de mail vanaf support@bingr.online.</p>
        <label>Reden <span class="sub">de klant ziet deze tekst</span><textarea id="bReason" maxlength="1000" rows="3" placeholder="Bijvoorbeeld: je account is gedeeld met meer mensen dan toegestaan." required></textarea></label>
        <label>Duur</label>
        <div id="bPresets" class="seg presets" role="group" aria-label="Duur van de blokkade">${PRESETS.map(([k, l]) => `<button type="button" data-k="${k}" class="${k === "7" ? "on" : ""}" aria-pressed="${k === "7"}">${l}</button>`).join("")}</div>
        <label class="until">Geblokkeerd tot<input id="bUntil" type="datetime-local"></label>
        <p id="bUntilTxt" class="sub"></p>
        <label class="switch"><input id="bNotify" type="checkbox" ${smtpOk ? "checked" : "disabled"}><span class="track"></span><span>Klant mailen (reden, einddatum en contact met support)</span></label>
        ${mailHint}
        <div id="bErr" class="err" role="alert"></div>
        <div class="form-btns"><button class="btn" type="submit">Blokkeren</button><button id="bCancel" class="btn ghost" type="button">Annuleren</button></div>
      </form>`}
      ${(b || hist.length) ? `<h3>Blokkades</h3><div class="block-hist">${(b ? [b] : []).concat(hist).map((x) => `<div class="bh">
        <div class="bh-h"><b>${esc(fmtDateTime(x.created_at))}</b> · ${esc(untilText(x.until))}
          ${x.lifted_at ? `<span class="chip">${esc(LIFTED[x.lifted_by] || "beëindigd")} ${esc(fmtDate(x.lifted_at))}</span>` : '<span class="chip bad">actief</span>'}
          ${x.notified ? '<span class="chip mail">gemaild</span>' : ""}</div>
        <div class="bh-r">${esc(x.reason)}</div></div>`).join("")}</div>` : ""}
      <section class="danger-zone" aria-labelledby="dzTitle">
        <h3 id="dzTitle">Account verwijderen</h3>
        <p class="sub">Verwijdert het account met profielen, apparaten en sessies, instellingen, servers, kijkgeschiedenis, statistieken en verzamelingen. Dit kan niet ongedaan worden gemaakt. De klant kan daarna altijd een nieuw account maken.</p>
        <label class="switch"><input id="dNotify" type="checkbox" ${smtpOk ? "checked" : "disabled"}><span class="track"></span><span>Bevestiging mailen vanaf support@bingr.online</span></label>
        <label class="switch"><input id="dTickets" type="checkbox"><span class="track"></span><span>Ook supporttickets verwijderen <span class="sub">(standaard bewaard, los van het account)</span></span></label>
        <label>Interne notitie <span class="sub">optioneel, alleen in het logboek</span><input id="dReason" maxlength="500" autocomplete="off"></label>
        <label>Typ het e-mailadres ter bevestiging <span class="sub">volledig, of precies zoals hierboven: ${esc(u.email)}</span>
          <input id="dConfirm" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="email"></label>
        <div id="dErr" class="err" role="alert"></div>
        <div class="form-btns"><button id="dBtn" class="btn danger-solid" disabled>Account definitief verwijderen</button></div>
      </section>`;
    $("resetBtn").onclick = async () => {
      if (!confirm(`Een wachtwoord-reset-mail sturen naar ${u.email}?`)) return;
      $("resetBtn").disabled = true;
      try { await call("send_reset", { user_id: u.id }); toast("Reset-mail verstuurd."); }
      catch (e) { if (e.code !== "auth") toast(errText(e), true); }
      finally { $("resetBtn").disabled = false; }
    };
    if (b) {
      $("ubBtn").onclick = async () => {
        $("ubBtn").disabled = true; $("ubErr").textContent = "";
        try {
          const r = await call("user_unblock", { id: u.id, notify: $("ubNotify").checked });
          toast(`Blokkade opgeheven${r.email_sent ? ", klant gemaild" : ""}.`);
          refreshUserViews(u.id);
        } catch (e) { if (e.code !== "auth") $("ubErr").textContent = errText(e); $("ubBtn").disabled = false; }
      };
    } else wireBlockForm(u);
    wirePlan(u);
    wireDelete(u);
  }
  // ---- abonnement in de lade: Gratis/Lifetime, eigen limieten (leeg = standaard) en een interne notitie
  function planSection(u) {
    const p = planObj(u.plan), life = p.plan === "lifetime";
    const src = p.source ? (PLAN_SOURCE[p.source] || p.source) : "";
    return `<section class="plan-box" aria-labelledby="plTitle">
      <h3 id="plTitle">Abonnement ${planChip(p)}</h3>
      <p class="sub">${life ? `Lifetime${src ? ", " + esc(src) : ""}${p.updated_at ? " · " + esc(fmtDate(p.updated_at)) : ""}` : "Gratis: 1 tegelijk kijken, 8 apparaten, 1 server, zonder statistieken, nu aan het kijken, Trakt en thema's."}</p>
      <form id="planForm" class="plan-form" novalidate>
        <label>Abonnement<select id="plPlan"><option value="free"${life ? "" : " selected"}>Gratis</option><option value="lifetime"${life ? " selected" : ""}>Lifetime (gratis gegeven)</option></select></label>
        <div class="plan-nums">
          <label>Tegelijk kijken <span class="sub" id="plSDef"></span><input id="plStreams" type="number" min="1" max="50" step="1" inputmode="numeric" value="${p.max_streams ?? ""}"></label>
          <label>Apparaten <span class="sub" id="plDDef"></span><input id="plDevices" type="number" min="1" max="200" step="1" inputmode="numeric" value="${p.max_devices ?? ""}"></label>
        </div>
        <label>Notitie <span class="sub">intern, de klant ziet hem niet</span><input id="plNote" maxlength="500" autocomplete="off" value="${esc(p.note || "")}"></label>
        <div id="plErr" class="err" role="alert"></div>
        <div class="form-btns"><button id="plSave" class="btn" type="submit">Abonnement opslaan</button></div>
      </form>
    </section>`;
  }
  function wirePlan(u) {
    const defs = () => {
      const d = PLAN_DEFAULTS[$("plPlan").value] || PLAN_DEFAULTS.free;
      $("plStreams").placeholder = `standaard ${d.streams}`; $("plDevices").placeholder = `standaard ${d.devices}`;
      $("plSDef").textContent = `standaard ${d.streams}`; $("plDDef").textContent = `standaard ${d.devices}`;
    };
    defs(); $("plPlan").onchange = defs;
    $("planForm").onsubmit = async (e) => {
      e.preventDefault();
      const num = (v) => (v.trim() === "" ? null : Number(v));
      const plan = $("plPlan").value, ms = num($("plStreams").value), md = num($("plDevices").value);
      if (ms !== null && !(Number.isInteger(ms) && ms >= 1 && ms <= 50)) { $("plErr").textContent = ERR.bad_max_streams; return; }
      if (md !== null && !(Number.isInteger(md) && md >= 1 && md <= 200)) { $("plErr").textContent = ERR.bad_max_devices; return; }
      const was = planObj(u.plan).plan;
      if (was === "lifetime" && plan === "free" && !confirm(`${u.email} terugzetten naar Gratis? Statistieken, nu aan het kijken, Trakt en thema's gaan dan op slot.`)) return;
      $("plSave").disabled = true; $("plErr").textContent = "";
      try {
        await call("plan_set", { id: u.id, plan, max_streams: ms, max_devices: md, note: $("plNote").value.trim() });
        toast(`Abonnement opgeslagen: ${PLAN_NAME[plan]}${ms != null || md != null ? " met eigen limieten" : ""}.`);
        refreshUserViews(u.id);
      } catch (err) { if (err.code !== "auth") $("plErr").textContent = errText(err); $("plSave").disabled = false; }
    };
  }
  function refreshUserViews(id) {
    openUser(id);
    if (loaded.users) loadUsers();
    if (loaded.overview) loadStats();
  }
  function wireBlockForm(u) {
    const form = $("blockForm");
    let preset = "7";
    const setUntil = () => {
      const custom = preset === "custom", forever = preset === "0";
      $("bUntil").disabled = forever;
      $("bUntil").closest("label").classList.toggle("hidden", forever);
      if (!custom && !forever) $("bUntil").value = localInput(new Date(Date.now() + Number(preset) * 864e5).toISOString());
      if (custom && !$("bUntil").value) $("bUntil").value = localInput(new Date(Date.now() + 864e5).toISOString());
      const v = forever ? "" : fromLocal($("bUntil").value);
      $("bUntilTxt").textContent = forever ? "De blokkade blijft staan tot je hem opheft." : v ? `Eindigt vanzelf op ${fmtDateTime(v)} (jouw tijd).` : "";
    };
    $("blockOpen").onclick = () => {
      const open = form.classList.toggle("hidden") === false;
      $("blockOpen").setAttribute("aria-expanded", String(open));
      if (open) { setUntil(); $("bReason").focus(); form.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    };
    $("bCancel").onclick = () => { form.classList.add("hidden"); $("blockOpen").setAttribute("aria-expanded", "false"); };
    $("bPresets").querySelectorAll("button").forEach((x) => (x.onclick = () => {
      preset = x.dataset.k;
      $("bPresets").querySelectorAll("button").forEach((y) => { y.classList.toggle("on", y === x); y.setAttribute("aria-pressed", String(y === x)); });
      setUntil();
      if (preset === "custom") $("bUntil").focus();
    }));
    $("bUntil").oninput = () => {
      if (preset !== "custom") { preset = "custom"; $("bPresets").querySelectorAll("button").forEach((y) => { const on = y.dataset.k === "custom"; y.classList.toggle("on", on); y.setAttribute("aria-pressed", String(on)); }); }
      setUntil();
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const reason = $("bReason").value.trim();
      const until = preset === "0" ? "onbepaald" : fromLocal($("bUntil").value);
      if (!reason) { $("bErr").textContent = ERR.reason_missing; $("bReason").focus(); return; }
      if (until !== "onbepaald" && (!until || Date.parse(until) < Date.now() + 60000)) { $("bErr").textContent = ERR.bad_until; return; }
      if (!confirm(`${u.email} blokkeren ${until === "onbepaald" ? "voor onbepaalde tijd" : `tot ${fmtDateTime(until)}`}? De klant wordt op alle apparaten uitgelogd.`)) return;
      const btn = form.querySelector("button[type=submit]"); btn.disabled = true; $("bErr").textContent = "";
      try {
        const r = await call("user_block", { id: u.id, reason, until, notify: $("bNotify").checked });
        toast(`Account geblokkeerd${r.email_sent ? ", klant gemaild" : $("bNotify").checked ? " (mail niet verstuurd)" : ""}.`, !r.email_sent && $("bNotify").checked);
        refreshUserViews(u.id);
      } catch (err) { if (err.code !== "auth") $("bErr").textContent = errText(err); btn.disabled = false; }
    };
  }
  function wireDelete(u) {
    // knop pas actief als het ingetypte adres lijkt te kloppen (de functie controleert het volledige adres)
    const masked = String(u.email || "").toLowerCase();
    const looksOk = (v) => v === masked || (/^[^\s@*]+@[^\s@*]+\.[^\s@*]+$/.test(v) && v[0] === masked[0] && v.slice(v.lastIndexOf(".")) === masked.slice(masked.lastIndexOf(".")));
    $("dConfirm").oninput = () => { $("dBtn").disabled = !looksOk($("dConfirm").value.trim().toLowerCase()); $("dErr").textContent = ""; };
    $("dBtn").onclick = async () => {
      if (!confirm(`Account ${u.email} definitief verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return;
      $("dBtn").disabled = true; $("dErr").textContent = "";
      try {
        const r = await call("user_delete", { id: u.id, confirm: $("dConfirm").value.trim(), notify: $("dNotify").checked,
          delete_tickets: $("dTickets").checked, reason: $("dReason").value.trim() });
        toast(`Account verwijderd${r.email_sent ? ", bevestiging gemaild" : ""}.`);
        closeDrawer();
        if (loaded.users) loadUsers();
        if (loaded.overview) loadStats();
      } catch (e) { if (e.code !== "auth") $("dErr").textContent = errText(e); $("dBtn").disabled = false; }
    };
  }
  function openDrawer(wide = false) { $("drawer").classList.toggle("wide", wide); $("drawer").classList.add("open"); $("drawer").setAttribute("aria-hidden", "false"); }
  function closeDrawer() {
    if (!$("drawer").classList.contains("open")) return;
    $("drawer").classList.remove("open"); $("drawer").setAttribute("aria-hidden", "true");
    if (/^#support\/\d+$/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
  }
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeDrawer));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  // ---- instellingen: upgrade-link per platform (app_settings.upgrade_link) ----
  const LINK_PLATFORMS = [
    ["apple", "Apple", "iPhone, iPad, Apple TV en Mac. Uit: de apps tonen de vergelijking, maar geen link, knop of QR-code."],
    ["android", "Android", "Telefoons en tablets"], ["androidtv", "Android TV", "Android TV, Google TV en Fire TV"],
    ["tizen", "Samsung TV", "Tizen"], ["web", "Web", "Webspeler en bingr.online"],
  ];
  async function loadSettings() {
    const el = $("linkSettings");
    el.innerHTML = '<p class="sub">Laden…</p>';
    let r;
    try { r = await call("app_settings_get"); } catch (e) { if (e.code !== "auth") el.innerHTML = `<p class="err">${esc(errText(e))}</p>`; return; }
    const v = r.upgrade_link || {};
    el.innerHTML = LINK_PLATFORMS.map(([k, l, h]) => `<label class="switch link-sw"><input type="checkbox" data-k="${k}"${v[k] ? " checked" : ""}><span class="track"></span><span><b>${esc(l)}</b><br><span class="sub">${esc(h)}</span></span></label>`).join("") +
      '<div id="linkErr" class="err" role="alert"></div><div class="form-btns"><button id="linkSave" class="btn">Opslaan</button></div>';
    $("linkSave").onclick = async () => {
      const upgrade_link = {};
      el.querySelectorAll("input[data-k]").forEach((i) => { upgrade_link[i.dataset.k] = i.checked; });
      $("linkSave").disabled = true; $("linkErr").textContent = "";
      try { await call("app_settings_set", { upgrade_link }); toast("Upgrade-link opgeslagen. De apps nemen het binnen een paar minuten over."); }
      catch (e) { if (e.code !== "auth") $("linkErr").textContent = errText(e); }
      finally { $("linkSave").disabled = false; }
    };
  }
  // build 97: overal uitloggen (alle browsers en de app): de functie verhoogt de tokenversie, alle tokens vervallen
  $("logoutAll").onclick = async () => {
    if (!confirm("Overal uitloggen? Alle sessies van het beheer (ook in de app en in andere browsers) vervallen meteen.")) return;
    $("logoutAll").disabled = true;
    try { await call("logout_all"); logout("Je bent overal uitgelogd."); }
    catch (e) { if (e.code !== "auth") toast(errText(e), true); }
    finally { $("logoutAll").disabled = false; }
  };

  // ---- downloads: buildpakketten op de server van beheer.bingr.online (acties builds / build_link) ----
  // De pakketten staan niet op GitHub; een download loopt via dl.php met een link van 10 minuten uit de functie admin.
  const DL_PLATFORMS = [
    ["android", "Android en Android TV", "APK voor telefoons, tablets, Android TV, Google TV en Fire TV"],
    ["tizen", "Samsung TV", ".wgt voor Tizen"],
    ["apple", "Apple", "Xcode-project (zip) voor iOS, iPadOS, tvOS en macOS"],
    ["beheer", "Bingr Beheer", "Xcode-project (zip) van deze beheer-app voor iPhone en iPad"],
  ];
  const DL_REASON = {
    not_configured: "Downloads nog niet ingericht: draai de workflow Builds.",
    no_builds: "Nog geen builds op de server.",
    unreachable: "De server met de builds is niet bereikbaar. Probeer het later opnieuw.",
  };
  function fmtSize(n) {
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return "—";
    const u = ["B", "kB", "MB", "GB"];
    let i = 0, v = n;
    while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
    return `${new Intl.NumberFormat("nl-NL", { maximumFractionDigits: i && v < 100 ? 1 : 0 }).format(v)} ${u[i]}`;
  }
  const dlBuild = (b) => (b.build != null && b.build !== "" ? `build ${b.build}` : b.file);
  const dlDate = (b) => (typeof b.date === "string" && b.date ? fmtDate(/^\d{4}-\d{2}-\d{2}$/.test(b.date) ? `${b.date}T12:00:00` : b.date) : "—");
  function dlButton(p, b, ghost) {
    return `<button class="btn small${ghost ? " ghost" : ""}" type="button" data-dl-p="${esc(p)}" data-dl-f="${esc(b.file)}">Downloaden</button>`;
  }
  function dlCard([p, title, hint], b) {
    if (!b) {
      return `<div class="panel bld-card"><div class="bld-head"><div><h2>${esc(title)}</h2><p class="sub">${esc(hint)}</p></div></div>
        <p class="empty">Nog geen build op de server.</p></div>`;
    }
    const hist = Array.isArray(b.history) ? b.history : [];
    return `<div class="panel bld-card">
      <div class="bld-head"><div><h2>${esc(title)}</h2><p class="sub">${esc(hint)}</p></div><span class="chip">${esc(dlBuild(b))}</span></div>
      <dl class="dl">
        <dt>Versie</dt><dd>${esc(b.version || "—")}</dd>
        <dt>Build</dt><dd>${esc(b.build ?? "—")}</dd>
        <dt>Datum</dt><dd>${esc(dlDate(b))}</dd>
        <dt>Grootte</dt><dd>${esc(fmtSize(b.size))}</dd>
        <dt>Bestand</dt><dd class="brk">${esc(b.file)}</dd>
        ${b.sha256 ? `<dt>SHA-256</dt><dd class="brk bld-hash">${esc(b.sha256)}</dd>` : ""}
      </dl>
      ${typeof b.notes === "string" && b.notes.trim() ? `<div class="bld-notes"><div class="sub">Notities</div><div class="bld-notes-body">${esc(b.notes.trim())}</div></div>` : ""}
      <div class="form-btns">${dlButton(p, b, false)}</div>
      ${hist.length ? `<div class="bld-hist"><div class="sub">Oudere builds</div><ul>${hist.map((h) => `<li><span><b>${esc(dlBuild(h))}</b>
        <span class="sub">${esc([h.version, dlDate(h), fmtSize(h.size)].filter((x) => x && x !== "—").join(" · "))}</span></span>${dlButton(p, h, true)}</li>`).join("")}</ul></div>` : ""}
    </div>`;
  }
  $("dlRefresh").onclick = () => loadDownloads();
  async function loadDownloads() {
    const el = $("dlList");
    el.innerHTML = '<p class="sub">Laden…</p>';
    $("dlUpdated").textContent = "";
    let r;
    try { r = await call("builds"); } catch (e) { if (e.code !== "auth") el.innerHTML = `<p class="empty">${esc(errText(e))}</p>`; return; }
    if (!r.ready || !r.platforms) {
      el.innerHTML = `<div class="panel"><p class="empty">${esc(DL_REASON[r.reason] || DL_REASON.no_builds)}</p></div>`;
      return;
    }
    if (r.updated) $("dlUpdated").textContent = `Bijgewerkt ${fmtDateTime(r.updated)}`;
    el.innerHTML = DL_PLATFORMS.map((x) => dlCard(x, r.platforms[x[0]])).join("");
    el.querySelectorAll("button[data-dl-p]").forEach((b) => (b.onclick = () => download(b)));
  }
  async function download(btn) {
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = "Link maken…";
    try {
      const r = await call("build_link", { platform: btn.dataset.dlP, file: btn.dataset.dlF });
      // same-origin (dl.php op beheer.bingr.online) zonder referrer; dl.php stuurt het bestand als bijlage
      const a = document.createElement("a");
      a.href = r.url; a.rel = "noreferrer"; a.download = r.file || "";
      document.body.appendChild(a); a.click(); a.remove();
      toast(`Download gestart: ${r.file}${r.size ? ` (${fmtSize(r.size)})` : ""}.`);
    } catch (e) {
      if (e.code === "build_not_found") loadDownloads();
      if (e.code !== "auth") toast(errText(e), true);
    } finally { btn.disabled = false; btn.textContent = old; }
  }

  // ---- support ----
  const SUP_ST = { new: "Nieuw", open: "In behandeling", pending: "Wacht op klant", resolved: "Opgelost", closed: "Gesloten" };
  const SUP_FILTERS = [["active", "Actief"], ["new", "Nieuw"], ["open", "In behandeling"], ["pending", "Wacht op klant"], ["resolved", "Opgelost"], ["closed", "Gesloten"], ["all", "Alles"]];
  const SUP_CAT = { account: "Account", afspelen: "Afspelen", apps: "Apps", website: "Website", overig: "Overig" };
  const SUP_PLAT = { ios: "iPhone/iPad", tvos: "Apple TV", macos: "Mac", android: "Android", androidtv: "Android TV", tizen: "Samsung TV", web: "Browser" };
  const SUP_PRIO = { low: "Laag", normal: "Normaal", high: "Hoog", urgent: "Urgent" };
  const supBadge = (st) => `<span class="sbadge ${esc(st)}">${esc(SUP_ST[st] || st)}</span>`;
  let supCounts = null, supFilter = "active", supPageNo = 0, supTotal = 0, supSearchTimer;
  const SUP_PAGE = 50;
  try { supFilter = sessionStorage.getItem(KEY + ".supFilter") || supFilter; } catch { /* */ }
  function supCountsText() {
    if (!supCounts) return "support";
    const u = supCounts.unread || 0;
    return u ? `${nf.format(u)} wacht${u === 1 ? "" : "en"} op reactie` : `${nf.format(supCounts.last_7d || 0)} nieuw in 7 dagen`;
  }
  function applySupportCounts(c) {
    if (!c) return;
    supCounts = c;
    const b = $("supBadge"), u = c.unread || 0;
    b.textContent = u > 99 ? "99+" : String(u); b.classList.toggle("hidden", !u);
    dashSupportChanged();
    renderSupFilters();
  }
  async function loadSupportCounts() {
    try { applySupportCounts(await call("support_counts")); } catch (e) { /* tab Support toont de fout */ }
  }
  function renderSupFilters() {
    const c = supCounts || {};
    $("supFilters").innerHTML = SUP_FILTERS.map(([k, l]) => {
      const n = k === "all" ? c.total : c[k];
      return `<button type="button" data-f="${k}" class="${k === supFilter ? "on" : ""}" aria-pressed="${k === supFilter}">${esc(l)}${n != null ? ` <span class="n">${nf.format(n)}</span>` : ""}</button>`;
    }).join("");
    $("supFilters").querySelectorAll("button").forEach((b) => (b.onclick = () => {
      supFilter = b.dataset.f; supPageNo = 0;
      try { sessionStorage.setItem(KEY + ".supFilter", supFilter); } catch { /* */ }
      loadTickets();
    }));
  }
  $("supRefresh").onclick = () => loadTickets();
  $("supSearch").oninput = () => { clearTimeout(supSearchTimer); supSearchTimer = setTimeout(() => { supPageNo = 0; loadTickets(); }, 300); };
  $("supPrev").onclick = () => { if (supPageNo > 0) { supPageNo--; loadTickets(); } };
  $("supNext").onclick = () => { if ((supPageNo + 1) * SUP_PAGE < supTotal) { supPageNo++; loadTickets(); } };
  // inbox-import (antwoorden per e-mail): statusregel boven de lijst
  const INBOX_RESULT = {
    imported: ["Reactie klant", "good"], agent: ["Antwoord support → klant", "good"], new_ticket: ["Nieuw ticket", "good"], duplicate: ["Al verwerkt", ""],
    "ignored:own_system": ["Eigen melding", ""], "ignored:auto": ["Automatisch antwoord", ""], "ignored:bulk": ["Nieuwsbrief/lijst", ""],
    "ignored:bounce": ["Bounce", ""], "ignored:spam": ["Spam", ""], "rejected:sender_mismatch": ["Geweigerd: ander adres dan de klant", "bad"],
    "rejected:agent_no_ticket": ["Geweigerd: geen ticket gevonden", "bad"], "rejected:auth_failed": ["Geweigerd: SPF/DMARC afgekeurd", "bad"],
    "rejected:rate_limited": ["Geweigerd: limiet", "bad"], "rejected:empty": ["Geweigerd: geen tekst", "bad"], "rejected:no_sender": ["Geweigerd: geen afzender", "bad"],
    "rejected:bad_email": ["Geweigerd: ongeldig adres", "bad"], error: ["Fout (volgende ronde opnieuw)", "bad"], "error:skipped": ["Fout, overgeslagen", "bad"],
  };
  let inboxLogOpen = false, inboxPolling = false;
  async function loadInbox() {
    const el = $("supInbox");
    let r;
    try { r = await call("support_inbox"); } catch (e) { if (e.code !== "auth") { el.className = "sup-inbox warn"; el.innerHTML = `<span class="dot"></span><span>E-mail-inbox: ${esc(errText(e))}</span>`; } return; }
    const st = r.state || {};
    let cls = "ok", txt;
    if (!r.configured) {
      cls = "off";
      txt = "<span>E-mail-inbox: <b>IMAP niet ingesteld</b>. Antwoorden per e-mail komen niet in de tickets en meldingen hebben de klant als Reply-To. Zet de secrets BINGR_IMAP_HOST, BINGR_IMAP_USER en BINGR_IMAP_PASSWORD (en BINGR_SUPPORT_AGENTS) in iptv-ios-appletv en draai de workflow Backend.</span>";
    } else {
      const failed = st.last_error && (!st.last_ok_at || st.last_error_at >= st.last_ok_at);
      const stale = !st.last_poll_at || Date.now() - new Date(st.last_poll_at).getTime() > 10 * 60000;
      const lr = st.last_result || {};
      const parts = [`laatst opgehaald <b>${esc(st.last_poll_at ? ago(st.last_poll_at) : "nog nooit")}</b>`];
      if (st.last_import_at) parts.push(`laatste import ${esc(ago(st.last_import_at))}`);
      if (!failed && st.last_ok_at) parts.push(`laatste ronde: ${nf.format(lr.fetched || 0)} mail${lr.fetched === 1 ? "" : "s"}${lr.more ? ", er staan er nog meer klaar" : ""}`);
      if (!r.extra_agents) parts.push("alleen antwoorden vanaf het supportadres zelf (BINGR_SUPPORT_AGENTS niet gezet)");
      if (failed) { cls = "warn"; parts.push(`<span class="err-t">fout: ${esc(st.last_error)}</span>`); }
      else if (stale) { cls = "warn"; parts.push('<span class="err-t">de planning (elke 2 min) lijkt niet te lopen</span>'); }
      txt = `<span>E-mail-inbox${r.user ? ` (${esc(r.user)})` : ""}: ${parts.join(" · ")}</span>`;
    }
    const log = (r.log || []).map((x) => {
      const [label, c] = INBOX_RESULT[x.result] || [x.result, ""];
      return `<li><span class="r t">${esc(fmtDateTime(x.at))}</span><span class="s" title="${esc(x.detail || "")}">${esc(x.subject || "(geen onderwerp)")} <span class="sub">${esc(x.sender || "")}</span></span><span class="r ${c}">${esc(label)}${x.ticket_number ? ` · <a href="#support/${x.ticket_number}">#${x.ticket_number}</a>` : ""}</span></li>`;
    }).join("");
    el.className = `sup-inbox ${cls}`;
    el.innerHTML = `<span class="dot"></span>${txt}${r.configured ? `<button id="supPoll" class="btn ghost small" type="button"${inboxPolling ? " disabled" : ""}>Nu ophalen</button>` : ""}` +
      (log ? `<details id="supInboxLog"${inboxLogOpen ? " open" : ""}><summary>Laatste mails in support@ (${(r.log || []).length})</summary><ol>${log}</ol></details>` : "");
    const d = $("supInboxLog"); if (d) d.ontoggle = () => { inboxLogOpen = d.open; };
    const b = $("supPoll");
    if (b) b.onclick = async () => {
      inboxPolling = true; b.disabled = true; b.textContent = "Ophalen…";
      try {
        const x = await call("support_poll");
        if (x.busy) toast("Er loopt al een ronde; probeer het zo opnieuw.");
        else if (x.skipped) toast("IMAP is niet ingesteld.", true);
        else if (x.ok === false) toast(`Ophalen mislukt: ${x.error || "onbekende fout"}`, true);
        else {
          const n = (x.imported || 0) + (x.agent || 0) + (x.new_tickets || 0);
          toast(n ? `${n} mail${n === 1 ? "" : "s"} verwerkt (${x.imported || 0} reactie${x.imported === 1 ? "" : "s"}, ${x.agent || 0} antwoord${x.agent === 1 ? "" : "en"} support, ${x.new_tickets || 0} nieuw).` : `Geen nieuwe mails voor tickets (${x.fetched || 0} bekeken).`);
        }
      } catch (e) { if (e.code !== "auth") toast(errText(e), true); }
      inboxPolling = false;
      loadTickets();
    };
  }

  async function loadTickets() {
    renderSupFilters();
    loadInbox();
    let r;
    try { r = await call("support_list", { status: supFilter, q: $("supSearch").value.trim(), page: supPageNo, page_size: SUP_PAGE }); }
    catch (e) {
      if (e.code === "auth") return;
      $("supNotice").textContent = errText(e); $("supNotice").classList.remove("hidden");
      $("supRows").innerHTML = `<tr><td colspan="6" class="empty">${esc(errText(e))}</td></tr>`; return;
    }
    $("supNotice").classList.toggle("hidden", r.smtp !== false);
    $("supNotice").textContent = r.smtp === false ? "E-mail is niet ingesteld (BINGR_SMTP_*): tickets komen binnen, maar klanten en support@bingr.online krijgen geen mail." : "";
    applySupportCounts(r.counts);
    supTotal = r.total || 0;
    $("supRows").innerHTML = (r.items || []).map((t) => `<tr data-n="${t.number}" tabindex="0" class="${t.unread ? "unread" : ""}">
      <td class="em num">${t.unread ? '<span class="udot" title="Klant wacht op reactie"></span>' : ""}#${t.number}</td>
      <td class="subj"><div class="st">${esc(t.subject)}</div><div class="sub">${esc(t.name || "")} · ${esc(t.email)}${t.has_account ? ' <span class="chip">account</span>' : ""}${t.priority === "high" || t.priority === "urgent" ? ` <span class="chip bad">${esc(SUP_PRIO[t.priority])}</span>` : ""}</div></td>
      <td data-l="Status">${supBadge(t.status)}</td>
      <td data-l="Categorie">${esc(SUP_CAT[t.category] || t.category)}${t.platform ? ` <span class="chip">${esc(SUP_PLAT[t.platform] || t.platform)}</span>` : ""}</td>
      <td data-l="Laatste activiteit">${esc(ago(t.last_reply_at))}</td>
      <td data-l="Aangemaakt">${esc(ago(t.created_at))}</td>
    </tr>`).join("") || `<tr><td colspan="6" class="empty">${$("supSearch").value.trim() ? "Geen tickets gevonden." : supFilter === "active" ? "Geen open tickets. Alles is beantwoord." : "Geen tickets."}</td></tr>`;
    $("supRows").querySelectorAll("tr[data-n]").forEach((tr) => {
      tr.onclick = () => openTicket(Number(tr.dataset.n));
      tr.onkeydown = (e) => { if (e.key === "Enter") openTicket(Number(tr.dataset.n)); };
    });
    const pages = Math.max(1, Math.ceil(supTotal / SUP_PAGE));
    $("supPage").textContent = `Pagina ${supPageNo + 1} van ${pages} · ${nf.format(supTotal)} ticket${supTotal === 1 ? "" : "s"}`;
    $("supPrev").disabled = supPageNo === 0; $("supNext").disabled = supPageNo + 1 >= pages;
  }
  function msgHtml(m) {
    const when = esc(fmtDateTime(m.created_at));
    if (m.author === "event") return `<div class="msg event"><span>Status: <b>${esc(SUP_ST[m.body] || m.body)}</b> · ${when}</span></div>`;
    const who = { customer: "Klant", support: "Bingr Support", note: "Interne notitie" }[m.author] || m.author;
    const viaMail = m.source === "email" ? `<span class="chip mail" title="${m.author === "support" ? "Per e-mail beantwoord (antwoord op een melding aan support@)" : "Per e-mail binnengekomen"}">✉ per e-mail</span>` : "";
    const mail = viaMail + (m.author === "support" ? (m.email_sent ? '<span class="chip">gemaild</span>' : `<span class="chip warn" title="${esc(m.email_error || "")}">niet gemaild</span>`) : "");
    return `<div class="msg ${esc(m.author)}"><div class="mh"><b>${esc(who)}</b><span class="sub">${when}</span>${mail}</div><div class="mb">${esc(m.body)}</div></div>`;
  }
  let supOpen = null;
  async function openTicket(n) {
    if (!n) return;
    supOpen = n;
    if (location.hash !== `#support/${n}`) history.replaceState(null, "", `#support/${n}`);
    $("drawerBody").innerHTML = '<p class="sub">Laden…</p>';
    openDrawer(true);
    let r;
    try { r = await call("support_get", { number: n }); }
    catch (e) { if (e.code !== "auth") $("drawerBody").innerHTML = `<h2 id="dTitle">#${esc(n)}</h2><p class="err">${esc(errText(e))}</p>`; return; }
    if (supOpen !== n) return;
    const t = r.ticket, a = r.account;
    const acc = a ? `${a.linked ? "Gekoppeld" : "Gevonden op e-mailadres"} · ${nf.format(a.device_count || 0)} apparaten${(a.platforms || []).length ? ` · ${a.platforms.map((p) => esc(pname(p))).join(", ")}` : ""}${(a.app_versions || []).length ? `<br><span class="sub">Versies: ${a.app_versions.map(esc).join(", ")}</span>` : ""}<br><span class="sub">Account sinds ${esc(fmtDate(a.created_at))}${a.last_seen_at ? ` · laatst gezien ${esc(ago(a.last_seen_at))}` : ""}${a.confirmed ? "" : " · onbevestigd"} · ${nf.format(a.tickets || 0)} ticket(s)</span>` : "Geen Bingr-account met dit adres";
    $("drawerBody").innerHTML = `
      <h2 id="dTitle"><span class="tnum">#${t.number}</span> ${esc(t.subject)}</h2>
      <div class="tmeta">${supBadge(t.status)}${t.priority !== "normal" ? ` <span class="chip ${t.priority === "low" ? "" : "bad"}">${esc(SUP_PRIO[t.priority] || t.priority)}</span>` : ""}<span class="sub">Aangemaakt ${esc(fmtDateTime(t.created_at))}</span></div>
      <dl class="dl">
        <dt>Klant</dt><dd>${esc(t.name || "—")}<br><a href="mailto:${esc(t.email)}">${esc(t.email)}</a></dd>
        <dt>Account</dt><dd>${acc}</dd>
        <dt>Categorie</dt><dd>${esc(SUP_CAT[t.category] || t.category)}${t.platform ? ` · ${esc(SUP_PLAT[t.platform] || t.platform)}` : ""}${t.app_version ? ` · Bingr ${esc(t.app_version)}` : ""}</dd>
        ${t.device_name || t.os_version ? `<dt>Apparaat</dt><dd>${esc([t.device_name, t.os_version].filter(Boolean).join(" · "))}</dd>` : ""}
        <dt>Taal</dt><dd>${t.lang === "en" ? "Engels" : "Nederlands"} <a class="sub" href="${esc(t.customer_url)}" target="_blank" rel="noopener noreferrer">Klantweergave openen ↗</a></dd>
      </dl>
      <h3>Gesprek</h3>
      <div class="thread">${(r.messages || []).map(msgHtml).join("") || '<p class="empty">Geen berichten.</p>'}</div>
      <form id="supForm" class="composer" novalidate>
        <div class="seg" role="group" aria-label="Soort bericht"><button type="button" data-k="reply" class="on" aria-pressed="true">Antwoord aan klant</button><button type="button" data-k="note" aria-pressed="false">Interne notitie</button></div>
        <label><span class="sr">Bericht</span><textarea id="supMsg" rows="6" maxlength="5000" placeholder="Typ je antwoord aan ${esc(t.name || "de klant")}…"></textarea></label>
        <div class="comp-row" id="supAfterRow"><label>Status na verzenden<select id="supAfter">
          <option value="pending">Wacht op klant</option><option value="open">In behandeling</option><option value="resolved">Opgelost</option><option value="closed">Gesloten</option></select></label>
          <button id="supSend" class="btn" type="submit">Versturen</button></div>
        <p id="supHint" class="sub">De klant krijgt een mail vanaf support@bingr.online met #${t.number} in het onderwerp${t.lang === "en" ? " (in het Engels)" : ""}.${r.smtp === false ? " <b>Let op: e-mail is niet ingesteld.</b>" : ""}</p>
        <div id="supErr" class="err" role="alert"></div>
      </form>
      <div class="actions sup-actions">
        <label>Status<select id="supStatus">${Object.entries(SUP_ST).map(([k, v]) => `<option value="${k}" ${k === t.status ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label>Prioriteit<select id="supPrio">${Object.entries(SUP_PRIO).map(([k, v]) => `<option value="${k}" ${k === t.priority ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label class="switch"><input id="supNotify" type="checkbox" checked><span class="track"></span><span>Klant mailen bij opgelost of gesloten</span></label>
        <button id="supSave" class="btn ghost" type="button">Opslaan</button>
      </div>`;
    let kind = "reply";
    $("drawerBody").querySelectorAll(".composer .seg button").forEach((b) => (b.onclick = () => {
      kind = b.dataset.k;
      $("drawerBody").querySelectorAll(".composer .seg button").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
      $("supAfterRow").querySelector("label").classList.toggle("hidden", kind === "note");
      $("supSend").textContent = kind === "note" ? "Notitie opslaan" : "Versturen";
      $("supMsg").placeholder = kind === "note" ? "Alleen zichtbaar in het beheer…" : `Typ je antwoord aan ${t.name || "de klant"}…`;
      $("supHint").classList.toggle("hidden", kind === "note");
      $("supForm").classList.toggle("note", kind === "note");
    }));
    $("supForm").onsubmit = async (e) => {
      e.preventDefault();
      const message = $("supMsg").value.trim();
      if (!message) { $("supErr").textContent = ERR.message_missing; return; }
      $("supSend").disabled = true; $("supErr").textContent = "";
      try {
        if (kind === "note") { await call("support_note", { number: t.number, message }); toast("Notitie opgeslagen."); }
        else {
          const x = await call("support_reply", { number: t.number, message, status: $("supAfter").value });
          toast(x.email_sent ? `Antwoord verstuurd naar ${t.email}.` : `Antwoord opgeslagen, maar de mail is niet verstuurd${x.email_error ? ` (${x.email_error})` : ""}.`, !x.email_sent);
        }
        await openTicket(t.number); loadTickets();
      } catch (err) { if (err.code !== "auth") $("supErr").textContent = errText(err); $("supSend").disabled = false; }
    };
    $("supSave").onclick = async () => {
      const status = $("supStatus").value, priority = $("supPrio").value;
      if (status === t.status && priority === t.priority) { toast("Niets gewijzigd."); return; }
      $("supSave").disabled = true;
      try {
        const x = await call("support_status", { number: t.number, status: status !== t.status ? status : undefined, priority: priority !== t.priority ? priority : undefined, notify: $("supNotify").checked });
        toast(x.email_sent ? `Opgeslagen; de klant is gemaild.` : x.email_sent === false ? `Opgeslagen, maar de mail is niet verstuurd.` : "Opgeslagen.", x.email_sent === false);
        await openTicket(t.number); loadTickets();
      } catch (err) { if (err.code !== "auth") toast(errText(err), true); $("supSave").disabled = false; }
    };
  }

  // ---- berichten ----
  let smtpOk = true, pvLang = "nl", sending = false;
  function applySmtp() {
    $("mail").disabled = !smtpOk; if (!smtpOk) $("mail").checked = false;
    $("smtpHint").classList.toggle("hidden", smtpOk);
  }
  function preview() {
    const en = pvLang === "en" && $("tEn").value.trim() && $("bEn").value.trim();
    $("pvTitle").textContent = (en ? $("tEn") : $("tNl")).value.trim() || "Titel";
    $("pvBody").textContent = (en ? $("bEn") : $("bNl")).value.trim() || "Tekst van het bericht";
  }
  ["tNl", "bNl", "tEn", "bEn"].forEach((id) => $(id).addEventListener("input", preview));
  document.querySelectorAll(".seg button").forEach((b) => (b.onclick = () => {
    pvLang = b.dataset.lang; document.querySelectorAll(".seg button").forEach((x) => x.classList.toggle("on", x === b)); preview();
  }));
  $("mail").onchange = () => { $("sendBtn").textContent = $("mail").checked ? "Plaatsen en e-mailen" : "Plaatsen"; };
  $("composeForm").onsubmit = async (e) => {
    e.preventDefault();
    if (sending) return;
    const data = {
      title_nl: $("tNl").value.trim(), body_nl: $("bNl").value.trim(), title_en: $("tEn").value.trim(), body_en: $("bEn").value.trim(),
      email: $("mail").checked, expires_at: $("exp").value ? new Date($("exp").value + "T23:59:59").toISOString() : null,
    };
    $("composeErr").textContent = "";
    if (!data.title_nl || !data.body_nl) { $("composeErr").textContent = ERR.text_missing; return; }
    if ((data.title_en && !data.body_en) || (!data.title_en && data.body_en)) { $("composeErr").textContent = "Vul bij Engels zowel titel als tekst in (of laat beide leeg)."; return; }
    if (!confirm(data.email ? "Dit bericht plaatsen in de apps én e-mailen naar alle gebruikers?" : "Dit bericht plaatsen in de apps?")) return;
    sending = true; $("sendBtn").disabled = true;
    try {
      const r = await call("announce", data);
      ["tNl", "bNl", "tEn", "bEn", "exp"].forEach((id) => ($(id).value = ""));
      preview();
      if (data.email) await sendMails(r.id, r.email_total);
      else toast("Bericht geplaatst.");
      loadAnnouncements();
    } catch (err) { if (err.code !== "auth") $("composeErr").textContent = errText(err); }
    finally { sending = false; $("sendBtn").disabled = false; }
  };
  async function sendMails(id, totalHint) {
    const box = $("progress"), bar = box.querySelector(".bar span"), txt = box.querySelector(".sub");
    box.classList.remove("hidden");
    const show = (r) => {
      const tot = r.email_total ?? totalHint ?? 0, done = (r.email_sent || 0) + (r.email_failed || 0);
      bar.style.width = `${tot ? Math.min(100, (done / tot) * 100) : 100}%`;
      txt.textContent = `${nf.format(r.email_sent || 0)} verstuurd${r.email_failed ? `, ${nf.format(r.email_failed)} mislukt` : ""} van ${nf.format(tot)}${r.done ? " · klaar" : "…"}`;
    };
    show({ email_total: totalHint });
    let r = {};
    for (let i = 0; i < 2000; i++) {
      try { r = await call("announce_send", { id }); }
      catch (e) { if (e.code !== "auth") toast(`${errText(e)} Je kunt later verder verzenden.`, true); loadAnnouncements(); return; }
      show(r);
      if (r.done) break;
      await new Promise((ok) => setTimeout(ok, 800));
    }
    toast(`E-mail klaar: ${nf.format(r.email_sent || 0)} verstuurd${r.email_failed ? `, ${nf.format(r.email_failed)} mislukt` : ""}.`, !!r.email_failed);
  }
  async function loadAnnouncements() {
    let r;
    try { r = await call("announcements_list"); } catch (e) { if (e.code !== "auth") toast(errText(e), true); return; }
    smtpOk = r.smtp !== false; applySmtp();
    const items = r.items || [];
    $("annList").innerHTML = items.map((a) => {
      const mail = a.email
        ? `<span>· e-mail: ${nf.format(a.email_sent)} / ${nf.format(a.email_total)}${a.email_failed ? `, ${nf.format(a.email_failed)} mislukt` : ""}${a.email_done_at ? "" : " (niet afgerond)"}</span>` : "";
      return `<div class="ann" data-id="${esc(a.id)}"><div class="main">
        <div class="tt">${esc(a.title_nl)}${a.title_en ? ` <span class="sub">/ ${esc(a.title_en)}</span>` : ""}</div>
        <div class="bd">${esc(a.body_nl)}</div>
        <div class="meta"><span class="badge ${a.active ? "on" : "off"}">${a.active ? "Actief" : "Verlopen"}</span>
          <span>${esc(fmtDateTime(a.created_at))}</span>${a.expires_at ? `<span>· tot ${esc(fmtDate(a.expires_at))}</span>` : ""}${mail}</div></div>
        <div class="btns">${a.email && !a.email_done_at ? '<button class="btn ghost small" data-act="resume">Verder verzenden</button>' : ""}
          <button class="btn danger small" data-act="del">Verwijderen</button></div></div>`;
    }).join("") || '<p class="empty">Nog geen berichten.</p>';
    $("annList").querySelectorAll(".ann").forEach((row) => {
      const id = row.dataset.id, a = items.find((x) => x.id === id);
      row.querySelector('[data-act="del"]').onclick = async () => {
        if (!confirm(`"${a.title_nl}" verwijderen? Apps tonen het dan niet meer.`)) return;
        try { await call("announcement_delete", { id }); toast("Bericht verwijderd."); loadAnnouncements(); }
        catch (e) { if (e.code !== "auth") toast(errText(e), true); }
      };
      const res = row.querySelector('[data-act="resume"]');
      if (res) res.onclick = async () => {
        if (sending) return;
        sending = true; res.disabled = true;
        try { await sendMails(id, a.email_total); } finally { sending = false; loadAnnouncements(); }
      };
    });
  }


  // ---- status ----
  const ST = { up: "Werkt", degraded: "Verminderd", down: "Storing" };
  const GRP = { server: "Server", website: "Website", apps: "Apps" };
  const KIND = { http: "Website (URL)", auth: "Supabase Auth", db: "Database", fn: "Edge Function", storage: "Opslag", smtp: "SMTP",
    tls: "TLS-certificaat", gh_asset: "GitHub-release", gh_workflow: "GitHub-build", devices: "Informatie" };
  const pctTxt = (v) => (v == null ? "—" : `${v.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}%`);
  const durTxt = (s) => { const m = Math.round((s || 0) / 60); if (m < 1) return "< 1 min"; if (m < 60) return `${m} min`; const h = Math.floor(m / 60); return `${h} uur${m % 60 ? ` ${m % 60} min` : ""}`; };
  let stData = null;
  $("stRun").onclick = async () => {
    $("stRun").disabled = true; $("stRun").textContent = "Bezig…";
    try {
      const r = await call("status", { op: "run" });
      if (r.busy) toast("Er loopt al een controle; probeer het over een minuut opnieuw.", true);
      else toast(`${r.checked} gecontroleerd: ${r.up} werkt, ${r.degraded} verminderd, ${r.down} storing.`, r.down > 0);
      await loadStatus();
    } catch (e) { if (e.code !== "auth") toast(errText(e), true); }
    finally { $("stRun").disabled = false; $("stRun").textContent = "Nu controleren"; }
  };
  $("stAdd").onclick = () => editMonitor(null);
  async function loadStatus() {
    let d;
    try { d = await call("status", { op: "overview" }); } catch (e) { if (e.code !== "auth") { toast(errText(e), true); $("stGroups").innerHTML = `<p class="empty">${esc(errText(e))}</p>`; } return; }
    stData = d;
    const all = d.groups.flatMap((g) => g.monitors);
    const name = (id) => all.find((m) => m.id === id)?.name?.nl || id;
    const ov = d.overall || { state: "up", down: [], degraded: [] };
    const lvl = ov.level || ({ down: "major", degraded: "degraded" })[ov.state] || "operational";
    const lcls = LVL_CLASS[lvl];
    const ids = (k) => esc((ov[k] || []).map(name).join(", "));
    $("stBanner").className = `st-banner ${lcls}`;
    $("stBanner").innerHTML = `<span class="st-dot ${lcls}"></span><div><b>${lvl === "major" ? `Grote storing: ${ids("major")}`
      : lvl === "partial" ? `Gedeeltelijke storing: ${ids("partial")}` : lvl === "degraded" ? `Verminderd: ${ids("degraded") || "zie meldingen"}`
      : lvl === "maintenance" ? `Onderhoud: ${ids("maintenance")}` : "Alle systemen werken"}</b>
      <span class="sub">Bijgewerkt ${esc(fmtDateTime(d.generated_at))} · zo staat het ook op bingr.online/status</span></div>`;
    const cron = d.scheduler?.cron;
    const lastRun = d.scheduler?.last_run_at;
    const openInc = (d.incidents || []).filter((i) => !i.ended_at).length;
    const info = [
      ["Planning", cron ? (cron.active ? "Actief" : "Uit") : "Geen", cron ? `pg_cron ${esc(cron.schedule)}${cron.last_run ? ` · ${esc(cron.last_run.status)} ${esc(ago(cron.last_run.start))}` : ""}` : "pg_cron niet gevonden", cron?.active ? "ok" : "bad"],
      ["Laatste controle", lastRun ? ago(lastRun) : "nooit", d.scheduler?.last_source ? `door ${esc({ cron: "planning", admin: "beheer", deploy: "deploy" }[d.scheduler.last_source] || d.scheduler.last_source)}` : "", lastRun && Date.now() - Date.parse(lastRun) < 12 * 60000 ? "ok" : "bad"],
      ["Alert-e-mail", d.alerts?.email ? "Aan" : "Uit", d.alerts?.email ? `${esc(d.alerts.email)}${d.alerts.smtp ? "" : " · SMTP ontbreekt"}` : "BINGR_ALERT_EMAIL niet ingesteld", d.alerts?.email && d.alerts.smtp ? "ok" : "warn"],
      ["Open storingen", String(openInc), openInc ? "zie hieronder" : "geen", openInc ? "bad" : "ok"],
      ["Abonnees", d.subscribers ? nf.format(d.subscribers.confirmed || 0) : "—", d.subscribers
        ? `${nf.format(d.subscribers.pending || 0)} onbevestigd · ${nf.format(d.subscribers.nl || 0)} NL / ${nf.format(d.subscribers.en || 0)} EN${d.subscribers.queue ? ` · ${d.subscribers.queue} in wachtrij` : ""}${d.subscribers.smtp ? "" : " · SMTP ontbreekt"}`
        : "niet beschikbaar", d.subscribers?.smtp === false ? "warn" : "ok"],
    ];
    $("stInfo").innerHTML = info.map(([l, v, h, c]) => `<div class="kpi st-${c}"><div class="l">${esc(l)}</div><div class="v sm">${esc(v)}</div><div class="h">${h}</div></div>`).join("");
    renderNotices(d);
    hbars($("stDevices"), (d.devices || []).map((p) => ({ label: esc(pname(p.platform)), n: p.devices })));
    $("stIncidents").innerHTML = (d.incidents || []).slice(0, 12).map((i) => `<div class="si ${i.ended_at ? "" : "open"}">
      <div><b>${esc(i.name?.nl || i.monitor_id)}</b>${i.ended_at ? "" : ' <span class="chip bad">loopt nog</span>'}<div class="sub">${esc(i.cause || "onbekende oorzaak")}</div></div>
      <div class="r"><div>${esc(fmtDateTime(i.started_at))}</div><div class="sub">${esc(durTxt(i.duration_s))}</div></div></div>`).join("") || '<p class="empty">Geen storingen in de laatste 90 dagen.</p>';
    $("stGroups").innerHTML = d.groups.map((g) => `<div class="panel st-group"><h2>${esc(g.name?.nl || GRP[g.id] || g.id)}</h2>${g.monitors.map((m) => {
      const st = m.kind === "devices" ? "info" : !m.enabled ? "off" : m.status ? LVL_CLASS[m.status] : m.state || "none";
      const days = (m.days || []).slice(-60);
      return `<div class="sm-row" data-id="${esc(m.id)}" tabindex="0">
        <div class="sm-name"><span class="st-dot ${st}"></span><div><b>${esc(m.name.nl)}</b>
          <div class="sub">${esc(KIND[m.kind] || m.kind)} · elke ${m.interval_min} min${m.public ? "" : ' · <span class="chip">niet openbaar</span>'}${m.enabled ? "" : ' · <span class="chip warn">uit</span>'}</div>
          ${m.last_error ? `<div class="sub err-line">${esc(m.last_error)}</div>` : ""}</div></div>
        ${m.kind === "devices" ? `<div class="sm-dev sub">${(d.devices || []).reduce((a, p) => a + p.devices, 0)} apparaten actief (laatste 15 min)</div>` : `
        <div class="sm-bars">${days.map((x) => `<i class="${x.s}" title="${esc(x.d)}: ${x.u == null ? "geen gegevens" : pctTxt(x.u)}"></i>`).join("")}</div>
        <div class="sm-num"><b>${esc(pctTxt(m.uptime?.d1))}</b><span class="sub">24 u</span></div>
        <div class="sm-num"><b>${esc(pctTxt(m.uptime?.d7))}</b><span class="sub">7 d</span></div>
        <div class="sm-num hide-m"><b>${esc(pctTxt(m.uptime?.d30))}</b><span class="sub">30 d</span></div>
        <div class="sm-num hide-m"><b>${esc(pctTxt(m.uptime?.d90))}</b><span class="sub">90 d</span></div>
        <div class="sm-num"><b>${m.ms24 != null ? nf.format(m.ms24) : "—"}</b><span class="sub">ms</span></div>`}
      </div>`;
    }).join("")}</div>`).join("");
    $("stGroups").querySelectorAll(".sm-row").forEach((r) => {
      const open = () => openMonitor(all.find((m) => m.id === r.dataset.id));
      r.onclick = open; r.onkeydown = (e) => { if (e.key === "Enter") open(); };
    });
  }

  // ---- meldingen: storingen en gepland onderhoud ----
  const LVL_CLASS = { operational: "up", maintenance: "maint", degraded: "degraded", partial: "partial", major: "down" };
  const NST = { investigating: "Wordt onderzocht", identified: "Oorzaak bekend", monitoring: "Wordt gevolgd", resolved: "Opgelost",
    scheduled: "Gepland", in_progress: "Bezig", completed: "Afgerond", cancelled: "Geannuleerd" };
  const IMPACT = { none: "Geen", minor: "Klein", major: "Groot", critical: "Kritiek" };
  const CIMP = { degraded: "Verminderd", partial: "Gedeeltelijk", major: "Storing" };
  const INC_ST = ["investigating", "identified", "monitoring", "resolved"], MNT_ST = ["scheduled", "in_progress", "completed", "cancelled"];
  // standaardteksten: één klik vult NL en EN, daarna aanpassen
  const TPL = {
    investigating: ["We onderzoeken een probleem met {c}. Zodra we meer weten, lees je het hier.", "We're investigating an issue with {c}. We'll post an update as soon as we know more."],
    identified: ["We hebben de oorzaak gevonden en werken aan een oplossing.", "We've identified the cause and are working on a fix."],
    monitoring: ["Er is een oplossing doorgevoerd. We houden in de gaten of alles weer normaal werkt.", "A fix has been implemented. We're monitoring the results."],
    resolved: ["Het probleem is opgelost. Alles werkt weer normaal. Excuses voor het ongemak.", "This issue has been resolved. Everything is working normally again. Sorry for the inconvenience."],
    scheduled: ["We voeren gepland onderhoud uit aan {c}. Tijdens het onderhoud kan dit even niet werken.", "We'll be performing scheduled maintenance on {c}. It may be briefly unavailable during this window."],
    in_progress: ["Het onderhoud is begonnen.", "The maintenance has started."],
    completed: ["Het onderhoud is afgerond. Alles werkt weer normaal.", "The maintenance has been completed. Everything is working normally."],
    cancelled: ["Het geplande onderhoud gaat niet door.", "The scheduled maintenance has been cancelled."],
  };
  Object.assign(ERR, {
    title_missing: "Vul een Nederlandse titel in.", message_missing: "Schrijf een bericht (Nederlands) voor de tijdlijn.", bad_window: "Kies een geldig tijdvak (einde na begin, max. 31 dagen).",
    bad_component: "Onbekend onderdeel.", bad_impact: "Ongeldige impact.", bad_time: "Ongeldige begintijd.", too_many_components: "Te veel onderdelen.",
  });
  const allMonitors = () => (stData?.groups || []).flatMap((g) => g.monitors.filter((m) => m.kind !== "devices").map((m) => ({ ...m, grp: g.id })));
  const mName = (id) => allMonitors().find((m) => m.id === id)?.name?.nl || id;
  const ntTone = (n) => (n.kind === "maintenance" ? "maint" : n.status === "resolved" ? "ok" : ({ critical: "down", major: "partial", minor: "degraded" })[n.impact] || "");
  const nChip = (st) => `<span class="chip st-${esc(st)}">${esc(NST[st] || st)}</span>`;
  const localInput = (iso) => { if (!iso) return ""; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const fromLocal = (v) => (v ? new Date(v).toISOString() : "");

  function renderNotices(d) {
    const all = d.all_notices || [];
    const now = Date.now();
    const open = all.filter((n) => (n.kind === "incident" && n.status !== "resolved") || n.status === "in_progress");
    const planned = all.filter((n) => n.status === "scheduled").sort((a, b) => Date.parse(a.window_start) - Date.parse(b.window_start));
    const past = all.filter((n) => !open.includes(n) && !planned.includes(n)).slice(0, 10);
    const row = (n) => {
      const when = n.kind === "maintenance" && n.window_start
        ? `${fmtDateTime(n.window_start)} – ${new Date(n.window_end).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`
        : `${fmtDateTime(n.started_at)}${n.resolved_at ? ` · ${durTxt((Date.parse(n.resolved_at) - Date.parse(n.started_at)) / 1000)}` : ` · loopt ${durTxt((now - Date.parse(n.started_at)) / 1000)}`}`;
      return `<div class="nt-row" data-id="${n.id}" tabindex="0"><span class="nt-bar ${ntTone(n)}"></span>
        <div class="nt-main"><b>${esc(n.title.nl)}</b><div class="sub">${n.kind === "maintenance" ? "Onderhoud" : `Storing · impact ${esc(IMPACT[n.impact] || n.impact)}`}${
          n.components.length ? ` · ${esc(n.components.map((c) => mName(c.id)).join(", "))}` : ""}${n.auto ? ' · <span class="chip">automatisch</span>' : ""}${n.notify === false ? ' · <span class="chip">geen mail</span>' : ""}</div></div>
        <div class="nt-r">${nChip(n.status)}<div>${esc(when)}</div></div></div>`;
    };
    $("ntList").innerHTML = (open.length ? `<div class="nt-sec">Lopend</div>${open.map(row).join("")}` : "")
      + (planned.length ? `<div class="nt-sec">Gepland</div>${planned.map(row).join("")}` : "")
      + (past.length ? `<div class="nt-sec">Afgelopen</div>${past.map(row).join("")}` : "")
      || '<p class="empty">Nog geen meldingen. Storingen die de monitoring vindt, verschijnen hier vanzelf.</p>';
    $("ntList").querySelectorAll(".nt-row").forEach((r) => {
      const go = () => openNotice(all.find((n) => n.id === Number(r.dataset.id)));
      r.onclick = go; r.onkeydown = (e) => { if (e.key === "Enter") go(); };
    });
  }
  $("ntNew").onclick = () => editNotice("incident", null);
  $("ntMaint").onclick = () => editNotice("maintenance", null);

  // keuzelijst met onderdelen (per groep), bij storingen met impact per onderdeel
  function compPicker(kind, sel) {
    const chosen = new Map((sel || []).map((c) => [c.id, c.impact]));
    const groups = stData?.groups || [];
    return `<div class="nt-comps">${groups.map((g) => {
      const ms = g.monitors.filter((m) => m.kind !== "devices");
      return ms.length ? `<div class="g">${esc(g.name?.nl || g.id)}</div>${ms.map((m) => `<label class="nt-c"><input type="checkbox" value="${esc(m.id)}" ${chosen.has(m.id) ? "checked" : ""}>
        <span>${esc(m.name.nl)}${m.public ? "" : ' <span class="chip">niet openbaar</span>'}</span>
        ${kind === "incident" ? `<select ${chosen.has(m.id) ? "" : "disabled"} aria-label="Impact op ${esc(m.name.nl)}">${Object.entries(CIMP).map(([k, v]) =>
          `<option value="${k}" ${(chosen.get(m.id) || "major") === k ? "selected" : ""}>${v}</option>`).join("")}</select>` : ""}</label>`).join("")}` : "";
    }).join("")}</div>`;
  }
  function wirePicker(root) {
    root.querySelectorAll(".nt-c input").forEach((cb) => { cb.onchange = () => { const s = cb.closest(".nt-c").querySelector("select"); if (s) s.disabled = !cb.checked; }; });
  }
  const readPicker = (root) => [...root.querySelectorAll(".nt-c input:checked")].map((cb) => ({ id: cb.value, impact: cb.closest(".nt-c").querySelector("select")?.value }));
  const compNames = (root) => readPicker(root).map((c) => allMonitors().find((m) => m.id === c.id)?.name || { nl: c.id, en: c.id });
  function fillTpl(st, root) {
    const t = TPL[st]; if (!t) return;
    const cs = compNames(root);
    const nl = cs.map((c) => c.nl).join(", ") || "een deel van Bingr", en = cs.map((c) => c.en || c.nl).join(", ") || "part of Bingr";
    $("nMsgNl").value = t[0].replace("{c}", nl); $("nMsgEn").value = t[1].replace("{c}", en);
  }

  // nieuwe storing / onderhoud plannen, of titel, impact, onderdelen en tijdvak wijzigen
  function editNotice(kind, n) {
    const isNew = !n, maint = kind === "maintenance";
    const start = n?.window_start || new Date(Date.now() + 864e5).toISOString().replace(/T.*/, "T01:00:00.000Z");
    const end = n?.window_end || new Date(Date.parse(start) + 3600e3).toISOString();
    openDrawer(true);
    $("drawerBody").innerHTML = `<h2 id="dTitle">${isNew ? (maint ? "Onderhoud plannen" : "Storing melden") : "Melding bewerken"}</h2>
      <p class="sub">${isNew ? "Komt meteen op bingr.online/status en (als je dat aanzet) per e-mail naar de abonnees." : "Wijzigt alleen de gegevens; een update in de tijdlijn plaats je vanuit de melding zelf. Hier gaat geen mail uit."}</p>
      <form id="nForm" novalidate>
        <div class="nt-row2"><label>Titel (Nederlands)<input id="nTnl" maxlength="140" value="${esc(n?.title?.nl || "")}" required></label>
        <label>Titel (Engels)<input id="nTen" maxlength="140" value="${esc(n && n.title.en !== n.title.nl ? n.title.en : "")}"></label></div>
        ${maint ? `<div class="nt-row2"><label>Begin<input id="nWs" type="datetime-local" value="${localInput(start)}" required></label>
          <label>Einde<input id="nWe" type="datetime-local" value="${localInput(end)}" required></label></div>`
          : `<div class="nt-row2"><label>Impact<select id="nImp">${Object.entries(IMPACT).map(([k, v]) => `<option value="${k}" ${(n?.impact || "minor") === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
          ${isNew ? `<label>Status<select id="nSt">${INC_ST.slice(0, 3).map((k) => `<option value="${k}">${NST[k]}</option>`).join("")}</select></label>` : "<span></span>"}</div>`}
        <label>Getroffen onderdelen</label>${compPicker(kind, n?.components)}
        ${isNew ? `<label>Bericht (Nederlands) <span class="sub">eerste update in de tijdlijn</span><textarea id="nMsgNl" class="nt-ta" maxlength="4000" required></textarea></label>
          <label>Bericht (Engels) <span class="sub">leeg = Nederlands</span><textarea id="nMsgEn" class="nt-ta" maxlength="4000"></textarea></label>
          <p class="sub"><a href="#" id="nTpl">Standaardtekst invullen</a></p>` : ""}
        <label class="switch"><input id="nNotify" type="checkbox" ${n?.notify === false ? "" : "checked"}><span class="track"></span><span>Abonnees mailen${stData?.subscribers ? ` (${nf.format(stData.subscribers.confirmed || 0)})` : ""}</span></label>
        ${!maint && !isNew && n.auto ? `<label class="switch"><input id="nAuto" type="checkbox" ${n.auto_resolve ? "checked" : ""}><span class="track"></span><span>Vanzelf oplossen als de monitoring weer groen is</span></label>` : ""}
        <div id="nErr" class="err" role="alert"></div>
        <div class="form-btns"><button class="btn" type="submit">${isNew ? (maint ? "Onderhoud plannen" : "Melding plaatsen") : "Opslaan"}</button>
          ${isNew ? "" : '<button id="nBack" class="btn ghost" type="button">Terug</button>'}</div>
      </form>`;
    const root = $("drawerBody");
    wirePicker(root);
    if ($("nTpl")) $("nTpl").onclick = (e) => { e.preventDefault(); fillTpl(maint ? "scheduled" : $("nSt").value, root); };
    if ($("nBack")) $("nBack").onclick = () => openNotice(n);
    $("nForm").onsubmit = async (e) => {
      e.preventDefault();
      const data = { op: "notice_save", id: n?.id || null, kind, title_nl: $("nTnl").value.trim(), title_en: $("nTen").value.trim(),
        components: readPicker(root), notify: $("nNotify").checked };
      if (maint) { data.window_start = fromLocal($("nWs").value); data.window_end = fromLocal($("nWe").value); }
      else { data.impact = $("nImp").value; if ($("nSt")) data.status = $("nSt").value; if ($("nAuto")) data.auto_resolve = $("nAuto").checked; }
      if (isNew) { data.message_nl = $("nMsgNl").value.trim(); data.message_en = $("nMsgEn").value.trim(); }
      if (!data.title_nl) { $("nErr").textContent = ERR.title_missing; return; }
      if (isNew && !data.message_nl) { $("nErr").textContent = ERR.message_missing; return; }
      if (maint && (!data.window_start || !data.window_end || data.window_end <= data.window_start)) { $("nErr").textContent = ERR.bad_window; return; }
      const btn = $("nForm").querySelector("button[type=submit]"); btn.disabled = true;
      try {
        const r = await call("status", data);
        toast(isNew ? `Melding geplaatst${r.queued ? (r.mailed?.sent ? `, ${r.mailed.sent} mail(s) verstuurd` : ", mail staat in de wachtrij") : ""}.` : "Melding opgeslagen.");
        await loadStatus();
        openNotice((stData?.all_notices || []).find((x) => x.id === (r.id || n?.id)));
      } catch (err) { if (err.code !== "auth") $("nErr").textContent = errText(err); btn.disabled = false; }
    };
  }

  // één melding: tijdlijn, update plaatsen (status + bericht), bewerken, verwijderen
  function openNotice(n) {
    if (!n) { closeDrawer(); return; }
    const maint = n.kind === "maintenance";
    const sts = maint ? MNT_ST : INC_ST;
    const closed = ["resolved", "completed", "cancelled"].includes(n.status);
    const next = maint ? (n.status === "scheduled" ? "in_progress" : "completed") : (n.status === "investigating" ? "identified" : n.status === "identified" ? "monitoring" : "resolved");
    openDrawer(true);
    $("drawerBody").innerHTML = `<h2 id="dTitle">${esc(n.title.nl)}</h2><p class="sub">${esc(n.title.en)}</p>
      <dl class="dl">
        <dt>Soort</dt><dd>${maint ? "Gepland onderhoud" : `Storing · impact ${esc(IMPACT[n.impact] || n.impact)}`}${n.auto ? ' <span class="chip">automatisch (monitoring)</span>' : ""}</dd>
        <dt>Status</dt><dd>${nChip(n.status)}</dd>
        <dt>${maint ? "Tijdvak" : "Begonnen"}</dt><dd>${maint ? `${esc(fmtDateTime(n.window_start))} – ${esc(fmtDateTime(n.window_end))}` : esc(fmtDateTime(n.started_at))}</dd>
        ${n.resolved_at ? `<dt>${maint ? "Afgerond" : "Opgelost"}</dt><dd>${esc(fmtDateTime(n.resolved_at))}${maint ? "" : ` · ${esc(durTxt((Date.parse(n.resolved_at) - Date.parse(n.started_at)) / 1000))}`}</dd>` : ""}
        <dt>Onderdelen</dt><dd>${n.components.length ? n.components.map((c) => `${esc(mName(c.id))}${maint ? "" : ` <span class="sub">(${esc(CIMP[c.impact] || c.impact)})</span>`}`).join(", ") : "—"}</dd>
        <dt>E-mail</dt><dd>${n.notify === false ? "uit voor deze melding" : "abonnees krijgen elke update"}${!maint && n.auto ? ` · ${n.auto_resolve ? "sluit vanzelf als alles weer werkt" : "sluit niet vanzelf"}` : ""}</dd>
        <dt>Openbaar</dt><dd><a href="https://bingr.online/status/incident/?id=${n.id}" target="_blank" rel="noopener">bingr.online/status/incident/?id=${n.id}</a></dd>
      </dl>
      <h3>Update plaatsen</h3>
      <form id="uForm" novalidate>
        <label>Status<select id="uSt">${sts.map((k) => `<option value="${k}" ${k === (closed ? n.status : next) ? "selected" : ""}>${NST[k]}</option>`).join("")}</select></label>
        <label>Bericht (Nederlands)<textarea id="nMsgNl" class="nt-ta" maxlength="4000" required></textarea></label>
        <label>Bericht (Engels) <span class="sub">leeg = Nederlands</span><textarea id="nMsgEn" class="nt-ta" maxlength="4000"></textarea></label>
        <p class="sub"><a href="#" id="uTpl">Standaardtekst voor deze status</a></p>
        ${maint ? "" : `<details><summary class="sub">Onderdelen en impact aanpassen</summary>${compPicker("incident", n.components)}</details>`}
        <label class="switch"><input id="uNotify" type="checkbox" ${n.notify === false ? "disabled" : "checked"}><span class="track"></span><span>Abonnees mailen${n.notify === false ? " (uit voor deze melding)" : ""}</span></label>
        <div id="uErr" class="err" role="alert"></div>
        <div class="form-btns"><button class="btn" type="submit">Update plaatsen</button></div>
      </form>
      <h3>Tijdlijn</h3>
      <ol class="nt-tl">${n.updates.map((u) => `<li class="st-${esc(u.status)}"><b>${esc(NST[u.status] || u.status)}</b><span class="sub">${esc(fmtDateTime(u.at))}</span>
        <p>${esc(u.body.nl)}</p>${u.body.en && u.body.en !== u.body.nl ? `<p class="en">${esc(u.body.en)}</p>` : ""}</li>`).join("")}</ol>
      <div class="actions"><button id="nEdit" class="btn ghost">Bewerken</button><button id="nDel" class="btn danger">Verwijderen</button></div>`;
    const root = $("drawerBody");
    wirePicker(root);
    const pickRoot = root.querySelector("details");
    $("uTpl").onclick = (e) => {
      e.preventDefault();
      const t = TPL[$("uSt").value]; if (!t) return;
      const cs = n.components.map((c) => allMonitors().find((m) => m.id === c.id)?.name || { nl: c.id, en: c.id });
      $("nMsgNl").value = t[0].replace("{c}", cs.map((c) => c.nl).join(", ") || "een deel van Bingr");
      $("nMsgEn").value = t[1].replace("{c}", cs.map((c) => c.en || c.nl).join(", ") || "part of Bingr");
    };
    $("nEdit").onclick = () => editNotice(n.kind, n);
    $("nDel").onclick = async () => {
      if (!confirm(`"${n.title.nl}" verwijderen? Hij verdwijnt van de statuspagina en uit de geschiedenis (er gaat geen mail uit).`)) return;
      try { await call("status", { op: "notice_delete", id: n.id }); toast("Melding verwijderd."); closeDrawer(); loadStatus(); }
      catch (err) { if (err.code !== "auth") toast(errText(err), true); }
    };
    $("uForm").onsubmit = async (e) => {
      e.preventDefault();
      const data = { op: "notice_update", id: n.id, status: $("uSt").value, message_nl: $("nMsgNl").value.trim(), message_en: $("nMsgEn").value.trim(),
        notify: $("uNotify").checked };
      if (pickRoot && pickRoot.open) data.components = readPicker(pickRoot);
      if (!data.message_nl) { $("uErr").textContent = ERR.message_missing; return; }
      const btn = $("uForm").querySelector("button[type=submit]"); btn.disabled = true;
      try {
        const r = await call("status", data);
        toast(`Update geplaatst${r.queued ? (r.mailed?.sent ? `, ${r.mailed.sent} mail(s) verstuurd` : ", mail staat in de wachtrij") : ""}.`);
        await loadStatus();
        openNotice((stData?.all_notices || []).find((x) => x.id === n.id));
      } catch (err) { if (err.code !== "auth") $("uErr").textContent = errText(err); btn.disabled = false; }
    };
  }

  // reactietijd van de laatste 24 uur (inline SVG), punten gekleurd per toestand
  function lineChart(el, items) {
    const pts = items.filter((c) => c.ms != null).map((c) => ({ t: Date.parse(c.at), y: c.ms, s: c.state })).sort((a, b) => a.t - b.t);
    if (pts.length < 2) { el.innerHTML = '<p class="empty">Nog te weinig controles voor een grafiek.</p>'; return; }
    const W = Math.max(300, Math.round(el.clientWidth || 420)), H = 170, L = 38, R = 6, T = 8, B = 20;
    const t1 = Date.now(), t0 = t1 - 24 * 3600e3;
    const max = Math.max(...pts.map((p) => p.y), 1), step = niceStep(max), top = Math.ceil(max / step) * step;
    const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R), y = (v) => T + (H - T - B) - (v / top) * (H - T - B);
    let g = '<g class="grid axis">';
    for (let v = 0; v <= top; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
    for (let h = 0; h <= 24; h += 6) { const tt = t0 + h * 3600e3; g += `<text x="${x(tt)}" y="${H - 5}" text-anchor="middle">${new Date(tt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</text>`; }
    g += "</g>";
    const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
    const dots = pts.filter((p) => p.s !== "up").map((p) => `<circle cx="${x(p.t)}" cy="${y(p.y)}" r="3" class="pt ${p.s}"/>`).join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Reactietijd laatste 24 uur">${g}<path d="${path}" class="ln"/>${dots}</svg>`;
  }

  async function openMonitor(m) {
    if (!m) return;
    openDrawer();
    $("drawerBody").innerHTML = `<h2 id="dTitle">${esc(m.name.nl)}</h2><p class="sub">${esc(m.name.en)} · ${esc(KIND[m.kind] || m.kind)}</p>
      <dl class="dl">
        <dt>Toestand</dt><dd>${esc(m.kind === "devices" ? "informatie" : !m.enabled ? "uit" : ST[m.state] || "geen gegevens")}</dd>
        ${m.target ? `<dt>Doel</dt><dd class="brk">${esc(m.target)}${m.keyword ? ` <span class="sub">trefwoord “${esc(m.keyword)}”</span>` : ""}</dd>` : ""}
        <dt>Laatst gecontroleerd</dt><dd>${esc(m.checked_at ? fmtDateTime(m.checked_at) : "nooit")}</dd>
        ${m.last_error ? `<dt>Laatste fout</dt><dd>${esc(m.last_error)}</dd>` : ""}
        <dt>Uptime</dt><dd>${esc(pctTxt(m.uptime?.d1))} (24 u) · ${esc(pctTxt(m.uptime?.d7))} (7 d) · ${esc(pctTxt(m.uptime?.d30))} (30 d) · ${esc(pctTxt(m.uptime?.d90))} (90 d)</dd>
      </dl>
      ${m.kind === "devices" ? "" : `<h3>Reactietijd (24 uur, ms)</h3><div id="stChart" class="chart"><p class="sub">Laden…</p></div>
      <h3>Laatste controles</h3><div id="stChecks" class="st-checks"><p class="sub">Laden…</p></div>`}
      <div class="actions"><button id="stEdit" class="btn ghost">Bewerken</button>
        ${m.kind === "devices" ? "" : '<button id="stOne" class="btn ghost">Deze nu controleren</button>'}</div>`;
    $("stEdit").onclick = () => editMonitor(m);
    if (m.kind === "devices") return;
    $("stOne").onclick = async () => {
      $("stOne").disabled = true;
      try { const r = await call("status", { op: "run", monitor_id: m.id }); if (r.busy) toast("Er loopt al een controle.", true); else { const x = (r.results || [])[0]; toast(x ? `${ST[x.state] || x.state}${x.ms != null ? `, ${x.ms} ms` : ""}${x.error ? `: ${x.error}` : ""}` : "Gecontroleerd.", x && !x.ok); } await loadStatus(); openMonitor((stData?.groups || []).flatMap((g) => g.monitors).find((y) => y.id === m.id)); }
      catch (e) { if (e.code !== "auth") toast(errText(e), true); $("stOne").disabled = false; }
    };
    let r;
    try { r = await call("status", { op: "checks", monitor_id: m.id, limit: 300 }); } catch (e) { if (e.code !== "auth") $("stChecks").innerHTML = `<p class="err">${esc(errText(e))}</p>`; return; }
    if (!$("stChart")) return;
    const items = r.items || [];
    lineChart($("stChart"), items);
    $("stChecks").innerHTML = items.length ? `<table><thead><tr><th>Tijd</th><th>Toestand</th><th>Code</th><th>ms</th><th>Melding</th></tr></thead><tbody>${
      items.slice(0, 60).map((c) => `<tr><td>${esc(new Date(c.at).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" }))}</td>
        <td><span class="st-dot ${c.state}"></span>${esc(ST[c.state] || c.state)}</td><td>${c.status_code ?? ""}</td><td>${c.ms ?? ""}</td>
        <td class="brk">${esc(c.error || c.detail || "")}</td></tr>`).join("")}</tbody></table>` : '<p class="empty">Geen controles in de laatste 24 uur.</p>';
  }

  function editMonitor(m) {
    const isNew = !m, http = isNew || m.kind === "http", fixedGroup = !isNew && m.builtin;
    const ints = stData?.intervals || [5, 10, 15, 30, 60, 360, 720, 1440];
    openDrawer();
    $("drawerBody").innerHTML = `<h2 id="dTitle">${isNew ? "Monitor toevoegen" : `${esc(m.name.nl)} bewerken`}</h2>
      ${isNew ? '<p class="sub">Controleert een webadres: antwoord 2xx binnen 10 seconden, en optioneel een woord in de pagina.</p>' : ""}
      <form id="stForm" novalidate>
        <label>Naam (Nederlands)<input id="fNl" maxlength="60" value="${esc(m?.name?.nl || "")}" required></label>
        <label>Naam (Engels)<input id="fEn" maxlength="60" value="${esc(m?.name?.en || "")}"></label>
        ${fixedGroup ? "" : `<label>Groep<select id="fGrp">${Object.entries(GRP).map(([k, v]) => `<option value="${k}" ${(m?.group || m?.grp || "website") === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>`}
        ${http ? `<label>Adres<input id="fUrl" type="url" placeholder="https://" value="${esc(m?.target || "")}" required></label>
        <label>Trefwoord <span class="sub">(optioneel: moet in de pagina staan)</span><input id="fKw" maxlength="100" value="${esc(m?.keyword || "")}"></label>` : ""}
        <label>Interval<select id="fInt">${ints.map((n) => `<option value="${n}" ${(m?.interval_min || 5) === n ? "selected" : ""}>${n < 60 ? `elke ${n} min` : `elke ${n / 60} uur`}</option>`).join("")}</select></label>
        ${m?.kind === "devices" ? "" : `<label class="switch"><input id="fPub" type="checkbox" ${m ? (m.public ? "checked" : "") : ""}><span class="track"></span><span>Tonen op de openbare statuspagina</span></label>`}
        <label class="switch"><input id="fOn" type="checkbox" ${!m || m.enabled ? "checked" : ""}><span class="track"></span><span>Aan</span></label>
        <div id="fErr" class="err" role="alert"></div>
        <div class="form-btns"><button class="btn" type="submit">${isNew ? "Toevoegen" : "Opslaan"}</button>
          ${!isNew && !m.builtin ? '<button id="fDel" class="btn danger" type="button">Verwijderen</button>' : ""}</div>
        ${!isNew && m.builtin ? '<p class="sub">Standaardmonitor: uitzetten kan, verwijderen niet.</p>' : ""}
      </form>`;
    // groepveld bestaat niet in de overzichtsdata van een monitor; die zit in de groep eromheen
    if (!isNew && $("fGrp")) { const g = (stData?.groups || []).find((x) => x.monitors.some((y) => y.id === m.id)); if (g) $("fGrp").value = g.id; }
    $("stForm").onsubmit = async (e) => {
      e.preventDefault();
      const data = { op: "monitor_save", id: m?.id || null, name_nl: $("fNl").value.trim(), name_en: $("fEn").value.trim(),
        grp: $("fGrp") ? $("fGrp").value : undefined, interval_min: Number($("fInt").value),
        public: $("fPub") ? $("fPub").checked : false, enabled: $("fOn").checked };
      if (http) { data.target = $("fUrl").value.trim(); data.keyword = $("fKw").value.trim(); }
      if (!data.name_nl) { $("fErr").textContent = ERR.name_missing; return; }
      try { await call("status", data); toast(isNew ? "Monitor toegevoegd." : "Monitor opgeslagen."); closeDrawer(); loadStatus(); }
      catch (err) { if (err.code !== "auth") $("fErr").textContent = errText(err); }
    };
    if ($("fDel")) $("fDel").onclick = async () => {
      if (!confirm(`Monitor "${m.name.nl}" en alle metingen verwijderen?`)) return;
      try { await call("status", { op: "monitor_delete", id: m.id }); toast("Monitor verwijderd."); closeDrawer(); loadStatus(); }
      catch (err) { if (err.code !== "auth") $("fErr").textContent = errText(err); }
    };
  }

  preview();
  if (!CFG.url) { showLogin("Supabase-instellingen ontbreken (assets/config.js)."); return; }
  if (session()) start(); else showLogin();
})();
