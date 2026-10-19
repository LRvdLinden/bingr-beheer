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
  // datum en tijd in Nederlandse tijd (nieuwsbrief: volgende verzending)
  const fmtNl = (v) => (v ? new Date(v).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "—");
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
    revenue_not_configured: "Omzet is nog niet ingericht (workflow Backend in iptv-ios-appletv draaien).", bad_rate: "Kies een btw-tarief tussen 0 en 50%.",
    billing_unavailable: "Betalen staat uit (geen STRIPE_SECRET_KEY).", bad_bucket: "Deze resolutie past niet bij de periode.", bad_mode: "Ongeldige keuze.",
    // build 97
    invalid_token: "Ongeldige of verlopen link.", unknown_action: "Onbekende actie (vernieuw de pagina; het dashboard is misschien bijgewerkt).",
    bad_priority: "Ongeldige prioriteit.", rate_limited: "Te veel verzoeken achter elkaar. Wacht een minuut en probeer het opnieuw.",
    // downloads (builds, build_link)
    bad_platform: "Onbekend platform.", bad_file: "Ongeldige bestandsnaam.",
    build_not_found: "Deze build staat niet (meer) op de server. Vernieuw de lijst.",
    builds_not_configured: "Downloads nog niet ingericht: draai de workflow Builds.",
    builds_unreachable: "De server met de builds is niet bereikbaar. Probeer het later opnieuw.",
    // naam van een account (user_set_name)
    bad_name: "Ongeldige naam: gebruik geen regeleinden of tekens als < en >.", name_too_long: "Een naam mag hoogstens 50 tekens zijn.",
    name_failed: "De naam kon niet worden opgeslagen. Probeer het opnieuw.",
  };
  // ---- abonnementen (zelfde standaarden als de server, docs/ACCOUNT.md in iptv-ios-appletv) ----
  const PLAN_DEFAULTS = { free: { streams: 1, devices: 8 }, lifetime: { streams: 3, devices: 15 } };
  const PLAN_NAME = { free: "Gratis", lifetime: "Lifetime" };
  const PLAN_SOURCE = { legacy: "cadeau bij de invoering (bestaand account)", admin: "via het beheer", purchase: "gekocht" };
  const planObj = (p) => (p && typeof p === "object" ? p : { plan: "free" });
  const isCustom = (p) => p.max_streams != null || p.max_devices != null;
  // build 133: bedrag in centen ("€ 4,99") en de laatste aankoop via Stripe (plan.purchased_at/amount/status)
  const euro = (c) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format((Number(c) || 0) / 100);
  const PURCHASE_STATUS = { paid: "gekocht", refunded: "terugbetaald", disputed: "chargeback", pending: "betaling onderweg", failed: "mislukt" };
  const purchaseText = (p) => (p && p.purchased_at ? `${PURCHASE_STATUS[p.status] || "gekocht"} op ${fmtDate(p.purchased_at)}${p.amount != null ? ` voor ${euro(p.amount)}` : ""}` : "");
  function planChip(raw) {
    const p = planObj(raw), life = p.plan === "lifetime";
    const lim = isCustom(p) ? ` · ${p.max_streams ?? PLAN_DEFAULTS[life ? "lifetime" : "free"].streams} str./${p.max_devices ?? PLAN_DEFAULTS[life ? "lifetime" : "free"].devices} app.` : "";
    const src = p.source === "purchase" && p.purchased_at ? purchaseText(p) : p.source ? (PLAN_SOURCE[p.source] || p.source) : "";
    const extra = !life && p.purchased_at && p.status !== "paid" ? ` (${purchaseText(p)})` : "";
    return `<span class="chip ${life ? "plan-life" : "plan-free"}" title="${esc(life ? `Lifetime${src ? ", " + src : ""}` : "Gratis" + extra)}${isCustom(p) ? " met eigen limieten" : ""}">${PLAN_NAME[life ? "lifetime" : "free"]}${esc(lim)}${life && p.source === "purchase" ? " €" : ""}</span>`;
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
  function logout(msg) { setSession(null); mem = null; closeMenu(false); closeDrawer(); showLogin(msg); }

  // ---- hamburgermenu rechtsboven (de enige navigatie, op elke breedte): paneel met de onderdelen, Overal uitloggen en
  // Uitloggen; badge op het icoon = ongelezen in Support. Toetsenbord: Enter/Spatie/pijl omlaag opent, pijlen/Home/End
  // lopen, Escape en Tab sluiten (focus terug op de knop).
  const menuBtn = $("menuBtn"), appMenu = $("appMenu");
  const menuItems = () => [...appMenu.querySelectorAll(".menu-it")];
  const menuOpen = () => !appMenu.classList.contains("hidden");
  function openMenu(focusLast = false) {
    const s = session() || mem;
    $("menuSession").textContent = s?.expires_at ? `Ingelogd tot ${fmtDateTime(s.expires_at)}` : "Beheer van Bingr";
    appMenu.classList.remove("hidden");
    menuBtn.setAttribute("aria-expanded", "true");
    const items = menuItems();
    (focusLast ? items[items.length - 1] : items[0])?.focus();
  }
  function closeMenu(refocus = true) {
    if (!menuOpen()) return;
    appMenu.classList.add("hidden");
    menuBtn.setAttribute("aria-expanded", "false");
    if (refocus) menuBtn.focus();
  }
  menuBtn.onclick = () => (menuOpen() ? closeMenu() : openMenu());
  menuBtn.onkeydown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openMenu(e.key === "ArrowUp"); }
    else if (e.key === "Escape" && menuOpen()) { e.stopPropagation(); closeMenu(); }
  };
  appMenu.onkeydown = (e) => {
    const items = menuItems(), i = items.indexOf(document.activeElement);
    const go = (n) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i < 0 ? -1 : i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(-1);
    // Escape sluit alleen het menu (niet ook de lade)
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(); }
    else if (e.key === "Tab") { e.preventDefault(); closeMenu(); }
  };
  document.addEventListener("click", (e) => { if (menuOpen() && !appMenu.contains(e.target) && !menuBtn.contains(e.target)) closeMenu(false); });
  appMenu.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => { closeMenu(); showTab(b.dataset.go); }));
  $("mLogout").onclick = () => { closeMenu(false); logout(); };
  $("mLogoutAll").onclick = () => { closeMenu(); logoutAll(); };
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
    // huidige pagina: gemarkeerd in het menu (aria-current) en in de titel van het tabblad; de kop staat in de inhoud
    let label = "";
    appMenu.querySelectorAll("[data-go]").forEach((b) => {
      if (b.dataset.go === name) { b.setAttribute("aria-current", "page"); label = b.querySelector("span")?.textContent || ""; }
      else b.removeAttribute("aria-current");
    });
    document.title = label ? `${label} · Beheer · Bingr` : "Beheer · Bingr";
    document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("hidden", s.id !== `tab-${name}`));
    try { sessionStorage.setItem(KEY + ".tab", name); } catch { /* */ }
    if (!loaded[name]) { loaded[name] = true; ({ overview: loadStats, insights: loadInsightsPage, revenue: loadRevenue, users: loadUsers, support: loadTickets, messages: loadPushTab, newsletter: loadNewsletter, status: loadStatus, downloads: loadDownloads, settings: loadSettings })[name](); }
  }

  function start() {
    $("login").classList.add("hidden"); $("app").classList.remove("hidden");
    Object.keys(loaded).forEach((k) => delete loaded[k]);
    let tab = "overview";
    try { tab = sessionStorage.getItem(KEY + ".tab") || tab; } catch { /* */ }
    // link uit de meldingsmail: https://beheer.bingr.online/#support/1001
    const deep = /^#support(?:\/(\d+))?$/.exec(location.hash);
    if (deep) tab = "support";
    showTab(["overview", "insights", "revenue", "users", "support", "messages", "newsletter", "status", "downloads", "settings"].includes(tab) ? tab : "overview");
    if (deep && deep[1]) openTicket(Number(deep[1]));
    loadSupportCounts();
    clearInterval(supTimer); supTimer = setInterval(() => { if (token() && !document.hidden) loadSupportCounts(); }, 120000);
  }
  let supTimer;
  window.addEventListener("hashchange", () => { const m = /^#support\/(\d+)$/.exec(location.hash); if (m && token()) { showTab("support"); openTicket(Number(m[1])); } });

  // ---- overzicht: instelbaar widget-dashboard ----
  // Zelfde JSON-model als de app BingrBeheer (README.md, "Dashboard"): {version: 1, widgets: [{id, type, size, hidden, options}]}.
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
    // build 133: Lifetime-aankopen via Stripe; omzet = som van de betaalde aankopen (terugbetaald telt niet mee)
    purchases_paid: { label: "Aankopen", v: (s) => s.purchases_paid, h: (s) => (s.purchases_refunded ? `${nf.format(s.purchases_refunded)} terugbetaald` : `${nf.format(s.purchases_7d ?? 0)} in 7 dagen`), cls: () => "life" },
    revenue_cents: { label: "Omzet", v: (s) => s.revenue_cents, f: (v) => euro(v), h: () => "betaald, zonder terugbetalingen" },
    // build 134: registratiebescherming (alleen aantallen; signup_guard in stats, null bij een ouder schema)
    signups_rejected: { label: "Registraties geweigerd (24 u)", v: (s) => s.signup_guard?.rejected_24h?.total,
      h: (s) => { const g = s.signup_guard, d = g.rejected_24h; return `limiet ${nf.format(d.rate_limit ?? 0)} · wegwerp ${nf.format(d.disposable ?? 0)} · naam ${nf.format(d.name ?? 0)} · 7 d: ${nf.format(g.rejected_7d?.total ?? 0)}`; },
      cls: (s) => (s.signup_guard?.rejected_24h?.total ? "blocked" : "") },
    unconfirmed_deleted: { label: "Onbevestigd verwijderd (7 d)", v: (s) => s.signup_guard?.unconfirmed_deleted_7d,
      h: (s) => `${nf.format(s.signup_guard?.unconfirmed_deleted_24h ?? 0)} in 24 uur · na 48 uur zonder bevestiging` },
  };
  const SUP_KEYS = ["new", "open", "pending", "resolved", "closed"];
  // Insights: metrics en series zoals in supabase/functions/admin/insights.ts (volgorde = kleur, vast per metric)
  const INS_METRICS = {
    accounts: { name: "Accounts", series: ["new_users", "active_users"] },
    signins: { name: "Inlogs", series: ["signins"] },
    streams: { name: "Streams", series: ["live", "movie", "episode"] },
    push: { name: "Pushmeldingen", series: ["sent", "failed"] },
    support: { name: "Supporttickets", series: ["new", "closed"] },
    purchases: { name: "Aankopen", series: ["paid", "refunded"] },
  };
  const INS_PERIODS = ["hour", "day", "week", "month", "year", "24h", "7d", "30d"];
  // platforms met systeem-push (push_devices); namen zoals in de tab Pushmeldingen
  const PUSH_PFS = ["ios", "ipados", "macos", "android", "web"];
  const PUSH_PF_NAME = { ios: "iPhone", ipados: "iPad", macos: "Mac", android: "Android", web: "Web" };
  // opties per type: [soort, toegestane waarden, standaard]; soort enum | bool | set (deelverzameling, niet leeg) | list (vrije tekst, leeg = alles)
  const WTYPES = {
    metric: { name: "Kengetal", desc: "Eén getal: gebruikers, actief, apparaten, kijkers, abonnementen, geblokkeerd…", sizes: ["s", "m"], size: "s",
      opts: { metric: ["enum", Object.keys(METRICS), "users_total"] } },
    // grafiek zoals Homey Insights (actie insights); vervangt "Per dag" (daily_chart wordt bij het laden omgezet, zie normWidget)
    insights: { name: "Grafiek (Insights)", desc: "Accounts, inlogs, streams, pushmeldingen of supporttickets door de tijd: kies uur, dag, week, maand of jaar en blader terug", sizes: ["s", "m", "l"], size: "l",
      opts: { insight: ["enum", Object.keys(INS_METRICS), "accounts"], period: ["enum", INS_PERIODS, "30d"], display: ["enum", ["auto", "line", "bar", "number"], "auto"], events: ["bool", null, true], off: ["hidden", null, []] } },
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
    // type-id "announcements" blijft (bewaarde indelingen); toont sinds build 14 van de app de pushgeschiedenis (push_history)
    announcements: { name: "Laatste pushmeldingen", desc: "De nieuwste pushmeldingen: beheer, releases en herinneringen", sizes: ["m", "l"], size: "l",
      opts: { count: ["enum", [3, 5], 3] } },
    push_subscribers: { name: "Pushabonnees", desc: "Accounts en apparaten met pushmeldingen aan, per platform", sizes: ["s", "m", "l"], size: "m",
      opts: { push_platforms: ["set", PUSH_PFS, PUSH_PFS], show_new: ["bool", null, true] } },
    newsletter: { name: "Nieuwsbrief", desc: "Abonnees van de nieuwsbrief (bevestigd e-mailadres) ten opzichte van alle leden", sizes: ["s", "m"], size: "s",
      opts: { show_langs: ["bool", null, true] } },
  };
  const OPT_LABEL = {
    metric: ["Getal", Object.fromEntries(Object.entries(METRICS).map(([k, m]) => [k, m.label]))],
    series: ["Gegevens", { new_users: "Nieuwe gebruikers", signins: "Inlogs (of actieve accounts als het inloglogboek leeg is)", active_users: "Accounts met app-activiteit" }],
    days: ["Periode", { 7: "Laatste 7 dagen", 14: "Laatste 14 dagen", 30: "Laatste 30 dagen" }],
    display: ["Weergave", { chart: "Grafiek", number: "Getal", list: "Lijst per status", auto: "Automatisch (staven voor aantallen per dag)", line: "Lijn", bar: "Staven" }],
    insight: ["Gegevens", { accounts: "Accounts: nieuw en actief", signins: "Inlogs", streams: "Streams: live tv, films en series", push: "Pushmeldingen: verstuurd en mislukt", support: "Supporttickets: nieuw en gesloten" }],
    period: ["Periode", { hour: "Uur (per 5 minuten)", day: "Dag (per uur)", week: "Week (per dag)", month: "Maand (per dag)", year: "Jaar (per maand)", "24h": "Laatste 24 uur", "7d": "Laatste 7 dagen", "30d": "Laatste 30 dagen" }],
    source: ["Periode", { "30d": "Gezien in de laatste 30 dagen", live: "Nu actief (laatste 15 minuten)" }],
    platforms: ["Platforms", null],
    plans: ["Abonnementen", { free: "Gratis", lifetime: "Lifetime", custom: "Eigen limieten" }],
    statuses: ["Statussen", { new: "Nieuw", open: "In behandeling", pending: "Wacht op klant", resolved: "Opgelost", closed: "Gesloten" }],
    count: ["Aantal", { 3: "3 meldingen", 5: "5 meldingen" }],
    push_platforms: ["Platforms", PUSH_PF_NAME],
    show_new: ["Nieuw in de laatste 7 dagen tonen"],
    show_incidents: ["Storingen tonen"],
    show_notices: ["Meldingen tonen (lopend en gepland)"],
    show_langs: ["Nederlands en Engels apart tonen"],
    events: ["Storingen en onderhoud op de tijdas tonen"],
  };
  // standaardindeling: lijkt op het vroegere vaste overzicht
  const DASH_DEFAULT = [
    ["users", "metric", "s", { metric: "users_total" }], ["new_7d", "metric", "s", { metric: "users_new_7d" }],
    ["active_today", "metric", "s", { metric: "active_today" }], ["active_30d", "metric", "s", { metric: "active_30d" }],
    ["devices", "metric", "s", { metric: "devices" }], ["watching", "metric", "s", { metric: "watching_now" }],
    ["support", "support", "s", {}], ["blocked", "metric", "s", { metric: "blocked" }],
    ["plan_free", "metric", "s", { metric: "plan_free" }], ["plan_lifetime", "metric", "s", { metric: "plan_lifetime" }],
    ["purchases", "metric", "s", { metric: "purchases_paid" }], ["revenue", "metric", "s", { metric: "revenue_cents" }],
    ["signups_rejected", "metric", "s", { metric: "signups_rejected" }], ["unconfirmed_deleted", "metric", "s", { metric: "unconfirmed_deleted" }],
    ["status", "status", "m", {}],
    ["chart_new", "insights", "l", { insight: "accounts", period: "30d" }], ["chart_streams", "insights", "l", { insight: "streams", period: "7d" }],
    ["chart_push", "insights", "l", { insight: "push", period: "30d" }],
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
      else if (kind === "hidden") o[k] = Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && /^[a-z_]{1,40}$/.test(x)))].slice(0, 10) : def.slice();
      else o[k] = Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && x && x.length <= 40))].slice(0, 30) : def.slice();
    }
    return o;
  }
  function newId(type, seen) { let i = 1; while (seen.has(`${type}_${i}`)) i++; return `${type}_${i}`; }
  // "Per dag" (daily_chart, tot BingrBeheer build 16) wordt een Insights-grafiek met dezelfde gegevens en periode
  function migrateWidget(w) {
    if (!isObj(w) || w.type !== "daily_chart") return w;
    const o = isObj(w.options) ? w.options : {};
    return { ...w, type: "insights", options: {
      insight: o.series === "signins" ? "signins" : "accounts", period: o.days === 7 ? "7d" : "30d",
      display: o.display === "number" ? "number" : "auto",
      off: o.series === "active_users" ? ["new_users"] : o.series === "signins" ? [] : ["active_users"] } };
  }
  function normWidget(w, seen) {
    w = migrateWidget(w);
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
  const dd = { stats: null, statsErr: null, status: null, statusErr: null, hist: null, histErr: null, subs: null, subsErr: null, nl: null, nlErr: null };
  const visible = () => dash.widgets.filter((w) => !w.hidden);
  const needs = () => {
    const v = visible();
    return {
      status: v.some((w) => w.type === "status" || (w.type === "platforms" && w.options.source === "live")),
      hist: v.some((w) => w.type === "announcements"), subs: v.some((w) => w.type === "push_subscribers"),
      nl: v.some((w) => w.type === "newsletter"),
    };
  };

  $("refresh").onclick = () => { insCache.clear(); loadStats(); loadSupportCounts(); };
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
    const [s, st, ph, sb, nl] = await Promise.allSettled([
      call("stats"), n.status ? call("status", { op: "overview" }) : Promise.resolve(null),
      n.hist ? call("push_history", { page: 0 }) : Promise.resolve(null), n.subs ? call("push_subscribers") : Promise.resolve(null),
      n.nl ? call("newsletter_status") : Promise.resolve(null),
    ]);
    dashLoading = false; $("refresh").disabled = false;
    if (n.nl) { if (nl.status === "fulfilled") { dd.nl = nl.value; dd.nlErr = null; } else dd.nlErr = errText(nl.reason); }
    if ([s, st, ph, sb, nl].some((r) => r.status === "rejected" && r.reason?.code === "auth")) return;
    if (s.status === "fulfilled") { dd.stats = s.value; dd.statsErr = null; smtpOk = !!s.value.smtp; }
    else { dd.statsErr = errText(s.reason); toast(dd.statsErr, true); }
    if (n.status) { if (st.status === "fulfilled") { dd.status = st.value; dd.statusErr = null; } else dd.statusErr = errText(st.reason); }
    if (n.hist) { if (ph.status === "fulfilled") { dd.hist = ph.value; dd.histErr = null; } else dd.histErr = errText(ph.reason); }
    if (n.subs) {
      if (sb.status === "fulfilled") { dd.subs = sb.value?.devices == null ? null : sb.value; dd.subsErr = dd.subs ? null : "Nog niet te tellen."; }
      else dd.subsErr = errText(sb.reason);
    }
    renderDash();
  }
  // na toevoegen of instellen: ontbrekende gegevens (status, pushmeldingen, abonnees) alsnog ophalen
  function ensureDashData() {
    const n = needs();
    if ((n.status && !dd.status && !dd.statusErr) || (n.hist && !dd.hist && !dd.histErr) || (n.subs && !dd.subs && !dd.subsErr) || (n.nl && !dd.nl && !dd.nlErr)
      || (!dd.stats && !dd.statsErr)) loadStats();
  }
  function dashSupportChanged() {
    if (!$("tab-overview").classList.contains("hidden") && dash.widgets.some((w) => w.type === "support" && !w.hidden)) {
      dash.widgets.filter((w) => w.type === "support" && !w.hidden).forEach((w) => { const el = document.querySelector(`#dash .w[data-id="${w.id}"]`); if (el) fillWidget(w, el); });
    }
  }

  function wTitle(w) {
    const o = w.options;
    switch (w.type) {
      case "metric": return METRICS[o.metric].label;
      case "insights": return INS_METRICS[o.insight].name;
      case "platforms": return o.source === "live" ? "Nu actieve apparaten" : "Actieve apparaten per platform";
      case "versions": return "App-versies in gebruik";
      case "plans": return "Abonnementen";
      case "support": return o.statuses.join() === "new,open,pending" ? "Open tickets" : "Supporttickets";
      case "status": return "Servicestatus";
      case "announcements": return "Laatste pushmeldingen";
      case "push_subscribers": return "Pushabonnees";
      case "newsletter": return "Nieuwsbrief";
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
    const needStats = !["support", "status", "announcements", "push_subscribers", "insights"].includes(w.type) && !(w.type === "platforms" && o.source === "live");
    if (needStats && !s) { body.innerHTML = dd.statsErr ? fail(dd.statsErr) : wait(); return; }
    switch (w.type) {
      case "metric": {
        const m = METRICS[o.metric], v = m.v(s);
        body.innerHTML = v == null ? tile(title, "—", "niet beschikbaar") : tile(title, m.f ? m.f(v) : nf.format(v), esc(m.h(s)), m.cls ? m.cls(s) : "");
        if (m.filter && v != null) onGo = go(() => goUsers(m.filter));
        break;
      }
      case "insights": fillInsights(w, el, body); return;
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
        // pushgeschiedenis (push_history, nieuwste eerst)
        if (!dd.hist) { body.innerHTML = dd.histErr ? fail(dd.histErr) : wait(); return; }
        const items = (dd.hist.items || []).slice(0, w.size === "m" ? 2 : o.count);
        body.innerHTML = `${head("Nieuwste eerst", "Pushmeldingen")}${items.length ? `<ul class="w-list">${items.map((m) => {
          const [kl, kc] = PUSH_KIND[m.kind] || PUSH_KIND.admin;
          return `<li><span class="w-li"><b>${esc(pushTitle(m))}</b><span class="sub"><span class="kind ${kc}">${kl}</span> ${esc(fmtDate(m.created_at))} · ${nf.format(m.sent || 0)} verstuurd${m.done ? "" : " · bezig"}</span></span></li>`;
        }).join("")}</ul>` : '<p class="empty">Nog geen pushmeldingen.</p>'}`;
        const more = body.querySelector("[data-go]"); if (more) more.onclick = () => showTab("messages");
        break;
      }
      case "push_subscribers": {
        if (!dd.subs) { body.innerHTML = dd.subsErr ? fail(dd.subsErr) : wait(); return; }
        const d = dd.subs, by = d.by_platform || {}, pf = o.push_platforms;
        const devs = pf.reduce((a, k) => a + (by[k] || 0), 0), all = pf.length === PUSH_PFS.length;
        const newTxt = o.show_new ? `+${nf.format(d.new_7d?.accounts || 0)} ${d.new_7d?.accounts === 1 ? "account" : "accounts"} in 7 dagen` : "";
        if (w.size === "s") {
          body.innerHTML = tile(title, nf.format(d.accounts || 0), esc([`${nf.format(all ? d.devices : devs)} ${(all ? d.devices : devs) === 1 ? "apparaat" : "apparaten"}`, newTxt].filter(Boolean).join(" · ")));
          onGo = go(() => showTab("messages"));
        } else {
          const rows = pf.map((k) => ({ n: by[k] || 0, label: esc(PUSH_PF_NAME[k] || k) }));
          body.innerHTML = `${head(all ? "Bingr-apps met pushmeldingen aan" : `Alleen ${pf.map((k) => PUSH_PF_NAME[k]).join(", ")}`, "Pushmeldingen")}
            <div class="w-sum"><b>${nf.format(d.accounts || 0)}</b> <span class="sub">${d.accounts === 1 ? "account" : "accounts"} · ${nf.format(all ? d.devices : devs)} apparaten${newTxt ? ` · ${esc(newTxt)}` : ""}</span></div>
            ${w.size === "l" ? '<div class="hbars"></div>' : `<p class="sub w-facts">${esc(pf.map((k) => `${PUSH_PF_NAME[k] || k} ${nf.format(by[k] || 0)}`).join(" · "))}</p>`}`;
          if (w.size === "l") hbars(body.querySelector(".hbars"), rows, 5);
          const more = body.querySelector("[data-go]"); if (more) more.onclick = () => showTab("messages");
        }
        break;
      }
      case "newsletter": {
        // abonnees (recipients.total van de functie newsletter: geabonneerd met bevestigd e-mailadres) / alle leden (stats)
        if (!dd.nl) { body.innerHTML = dd.nlErr ? fail(dd.nlErr) : wait(); return; }
        const r = dd.nl.recipients || {}, subs = r.total || 0, all = s.total_users || 0;
        const pct = all ? `${Math.round((subs / all) * 100)}%` : "—";
        const state = dd.nl.enabled ? (dd.nl.next?.at ? `aan · volgende ${fmtNl(dd.nl.next.at)}` : "aan") : "uit";
        const langs = o.show_langs ? `${nf.format(r.nl || 0)} NL · ${nf.format(r.en || 0)} EN` : "";
        if (w.size === "s") {
          body.innerHTML = tile(title, `${nf.format(subs)}<small class="w-of"> / ${nf.format(all)}</small>`, esc([`${pct} van de leden`, langs, `verzending ${dd.nl.enabled ? "aan" : "uit"}`].filter(Boolean).join(" · ")));
        } else {
          body.innerHTML = `${head(null, "Nieuwsbrief")}<div class="w-sum"><b>${nf.format(subs)}</b> <span class="sub">van ${nf.format(all)} leden (${esc(pct)})</span></div>
            <p class="sub w-facts">${esc([langs, `Verzending ${state}`].filter(Boolean).join(" · "))}</p>`;
          const more = body.querySelector("[data-go]"); if (more) more.onclick = () => showTab("newsletter");
        }
        if (w.size === "s") onGo = go(() => showTab("newsletter"));
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
        ${Object.entries(t.opts).filter(([, spec]) => spec[0] !== "hidden").map(([k, spec]) => field(k, spec)).join("")}
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
      const raw = { ...(w.options.off ? { off: w.options.off } : {}) };
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

  // ---- overzicht: grafieken zoals Homey Insights (actie insights) ----
  // Periodekiezer (uur … jaar, laatste 24 uur / 7 / 30 dagen), bladeren met ‹ › en Nu, crosshair met tooltip (muis, vinger,
  // pijltjestoetsen), series aan/uit (de samenvattingsknoppen zijn de legenda), samenvatting met verandering t.o.v. de vorige
  // periode. Alleen aantallen per tijdvak uit de functie admin; tijden in Nederlandse tijd. Zelf getekend als SVG (geen CDN).
  const INS_TZ = "Europe/Amsterdam";
  const INS_PERIOD_TAB = { hour: "Uur", day: "Dag", week: "Week", month: "Maand", year: "Jaar", "24h": "24 uur", "7d": "7 dagen", "30d": "30 dagen" };
  const INS_PREV = { hour: "vorig uur", day: "gisteren", week: "vorige week", month: "vorige maand", year: "vorig jaar", "24h": "24 uur ervoor", "7d": "7 dagen ervoor", "30d": "30 dagen ervoor" };
  // series waarvoor minder beter is (pijl omlaag = goed)
  const INS_DOWN_GOOD = new Set(["failed"]);
  const insCache = new Map(), insOffset = new Map(), insSeq = new Map();
  const insFmt = (o) => new Intl.DateTimeFormat("nl-NL", { timeZone: INS_TZ, ...o });
  const F = {
    time: insFmt({ hour: "2-digit", minute: "2-digit" }), hour: insFmt({ hour: "2-digit" }),
    wd: insFmt({ weekday: "short" }), wdDay: insFmt({ weekday: "short", day: "numeric" }), dayMon: insFmt({ day: "numeric", month: "short" }),
    mon: insFmt({ month: "short" }), monYear: insFmt({ month: "long", year: "numeric" }), year: insFmt({ year: "numeric" }),
    long: insFmt({ weekday: "long", day: "numeric", month: "long" }), longY: insFmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    dayMonY: insFmt({ day: "numeric", month: "short", year: "numeric" }), dayNum: insFmt({ day: "numeric" }),
  };
  const compact = (v) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}M` : Math.abs(v) >= 1e4 ? `${(v / 1e3).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}K` : v.toLocaleString("nl-NL", { maximumFractionDigits: 1 }));
  const n1 = (v) => (v == null ? "—" : v.toLocaleString("nl-NL", { maximumFractionDigits: 1 }));
  // bedragen (tab Omzet: series met money = centen) of aantallen
  const fmtVal = (s, v) => (v == null ? "—" : s?.money ? euro(v) : nf.format(v));
  const sumVal = (s, v) => (v == null ? "—" : s?.money ? euro(v) : n1(v));
  const axisVal = (money, v) => (money ? `€ ${compact(v / 100)}` : compact(v));

  /** Tekst van de periode boven de grafiek, bv. "Deze week · 12–18 okt" of "Oktober 2026". */
  function insRangeText(d) {
    const a = new Date(d.from), b = new Date(Date.parse(d.to) - 1), cur = d.offset === 0;
    const span = () => (F.year.format(a) === F.year.format(b) ? `${F.dayMon.format(a)} – ${F.dayMonY.format(b)}` : `${F.dayMonY.format(a)} – ${F.dayMonY.format(b)}`);
    switch (d.period) {
      case "hour": return `${cur ? "Dit uur · " : ""}${F.dayMon.format(a)}, ${F.time.format(a)}–${F.time.format(new Date(d.to))}`;
      case "day": return cur ? `Vandaag · ${F.long.format(a)}` : d.offset === -1 ? `Gisteren · ${F.long.format(a)}` : F.longY.format(a);
      case "week": return `${cur ? "Deze week · " : d.offset === -1 ? "Vorige week · " : ""}${span()}`;
      case "month": { const t = F.monYear.format(a); return (cur ? "Deze maand · " : "") + t.charAt(0).toUpperCase() + t.slice(1); }
      case "year": return `${cur ? "Dit jaar · " : ""}${F.year.format(a)}`;
      case "24h": return cur ? "Laatste 24 uur" : `${F.dayMon.format(a)} ${F.time.format(a)} – ${F.dayMon.format(new Date(d.to))} ${F.time.format(new Date(d.to))}`;
      default: return `${cur ? `Laatste ${d.period === "7d" ? 7 : 30} dagen · ` : ""}${span()}`;
    }
  }
  /** Tijd van één tijdvak in de tooltip. */
  function insBucketText(d, i) {
    const a = new Date(d.edges[i]), b = new Date(d.edges[i + 1]);
    if (d.step === "5min") return `${F.time.format(a)}–${F.time.format(b)}`;
    if (d.step === "hour") return `${F.long.format(a)}, ${F.time.format(a)}–${F.time.format(b)}`;
    if (d.step === "day") return F.longY.format(a);
    if (d.step === "month") { const t = F.monYear.format(a); return t.charAt(0).toUpperCase() + t.slice(1); }
    const e = new Date(Date.parse(d.edges[i + 1]) - 1);
    return `Week ${isoWeek(a)} · ${F.dayMon.format(a)} – ${F.dayMon.format(e)}`;
  }
  // ISO-weeknummer van een moment (op de lokale datum in Nederland)
  const ymdFmt = insFmt({ year: "numeric", month: "numeric", day: "numeric" });
  function isoWeek(t) {
    const parts = ymdFmt.formatToParts(t), g = (k) => Number(parts.find((p) => p.type === k).value);
    const date = new Date(Date.UTC(g("year"), g("month") - 1, g("day")));
    date.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7)); // donderdag van die week
    return 1 + Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 1)) / (7 * 864e5));
  }
  /** As-labels: welk tijdvak een label krijgt en welke tekst (uren, weekdagen, dagen of maanden, naar de periode). */
  function insTicks(d, width) {
    const n = d.edges.length - 1, room = Math.max(2, Math.floor(width / 58));
    const at = (i) => new Date(d.edges[i]);
    if (d.step === "month") {
      const k = 12 <= room ? 1 : 6 <= room ? 2 : 3;
      return [...Array(n).keys()].filter((i) => i % k === 0).map((i) => [i, F.mon.format(at(i)).replace(".", "")]);
    }
    if (d.step === "week") {
      // maandnamen bij de week waarin de maand begint
      const mon = (i) => F.mon.format(at(i)).replace(".", ""), k = 12 <= room ? 1 : 6 <= room ? 2 : 3;
      const starts = [...Array(n).keys()].filter((i) => i === 0 || mon(i) !== mon(i - 1));
      return starts.filter((_, j) => j % k === 0).map((i) => [i, mon(i)]);
    }
    if (d.step === "day") {
      if (n <= 7) return [...Array(n).keys()].map((i) => [i, room >= 7 ? F.wdDay.format(at(i)) : F.wd.format(at(i))]);
      const k = [1, 2, 5, 7, 10].find((x) => Math.ceil(n / x) <= room) || 10;
      // vanaf het eind tellen (vandaag heeft altijd een label bij de laatste N dagen), bij een maand vanaf de 1e
      const from = d.period === "month" ? 0 : (n - 1) % k;
      return [...Array(n).keys()].filter((i) => i >= from && (i - from) % k === 0).map((i) => [i, F.dayMon.format(at(i)).replace(".", "")]);
    }
    if (d.step === "hour") {
      const hourOf = (i) => Number(F.hour.format(at(i)));
      if (n > 48) { // week per uur: één label per dag (om middernacht)
        const mids = [...Array(n).keys()].filter((i) => hourOf(i) === 0), k = mids.length <= room ? 1 : 2;
        return mids.filter((_, j) => j % k === 0).map((i) => [i, room >= 7 ? F.wdDay.format(at(i)) : F.wd.format(at(i))]);
      }
      const k = [1, 2, 3, 4, 6, 12].find((x) => Math.ceil(n / x) <= room) || 12;
      return [...Array(n).keys()].filter((i) => hourOf(i) % k === 0).map((i) => [i, hourOf(i) === 0 && d.period === "24h" ? F.dayMon.format(at(i)).replace(".", "") : F.time.format(at(i))]);
    }
    const k = [1, 2, 3, 6].find((x) => Math.ceil(n / x) <= room) || 6;
    return [...Array(n).keys()].filter((i) => i % k === 0).map((i) => [i, F.time.format(at(i))]);
  }
  const insKey = (w, off) => `${w.options.insight}|${w.options.period}|${off}|${w.options.events ? 1 : 0}`;
  function insDisplay(w, d) {
    const o = w.options.display;
    if (o === "line" || o === "bar") return o;
    // automatisch: staven voor aantallen per dag of maand van gebeurtenissen (pushmeldingen, tickets), anders een lijn
    return (d.step === "day" || d.step === "week") && (w.options.insight === "push" || w.options.insight === "support") ? "bar" : "line";
  }

  // inhoud van een Insights-widget: kop met bladeren, periodes, samenvatting/legenda en de grafiek
  function fillInsights(w, el, body) {
    const o = w.options, title = esc(wTitle(w)), off = insOffset.get(w.id) || 0;
    const cached = insCache.get(insKey(w, off));
    if (o.display === "number" || w.size === "s") {
      el.classList.add("tile");
      body.innerHTML = `<div class="kpi-in"><div class="l">${title}</div><div class="v ins-skel-v">${cached ? "" : '<span class="skel skel-num"></span>'}</div><div class="h"></div></div>`;
    } else {
      const nav = dashEdit ? "" : `<div class="ins-nav" role="group" aria-label="Periode bladeren">
          <button type="button" class="ins-ic" data-nav="-1" aria-label="Vorige periode" title="Vorige periode">${ICO.up}</button>
          <button type="button" class="ins-now" data-nav="now" aria-label="Terug naar nu" ${off === 0 ? "disabled" : ""}>Nu</button>
          <button type="button" class="ins-ic" data-nav="1" aria-label="Volgende periode" title="Volgende periode" ${off === 0 ? "disabled" : ""}>${ICO.down}</button></div>`;
      body.innerHTML = `<div class="ins-head"><div class="w-ht"><h2>${title}</h2><p class="sub ins-range">&nbsp;</p></div>${nav}</div>
        <div class="ins-periods" role="radiogroup" aria-label="Periode van ${title}">${INS_PERIODS.map((p, i) =>
          `${i === 5 ? '<span class="ins-sep" aria-hidden="true"></span>' : ""}<button type="button" role="radio" data-p="${p}" aria-checked="${p === o.period}" class="${p === o.period ? "on" : ""}" ${dashEdit ? "disabled" : ""}>${INS_PERIOD_TAB[p]}</button>`).join("")}</div>
        <div class="ins-series"></div><div class="ins-chart chart"></div>`;
      body.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => {
        if (b.dataset.p === o.period) return;
        o.period = b.dataset.p; insOffset.delete(w.id); saveLayout();
        fillInsights(w, el, body); body.querySelector(`[data-p="${o.period}"]`)?.focus();
        announce(`${wTitle(w)}: ${OPT_LABEL.period[1][o.period]}`);
      }));
      body.querySelectorAll("[data-nav]").forEach((b) => (b.onclick = () => {
        const v = b.dataset.nav, cur = insOffset.get(w.id) || 0, next = v === "now" ? 0 : Math.min(0, cur + Number(v));
        if (next === cur) return;
        insOffset.set(w.id, next); fillInsights(w, el, body);
        const f = body.querySelector(`[data-nav="${v}"]`); (f && !f.disabled ? f : body.querySelector('[data-nav="-1"]'))?.focus();
      }));
    }
    if (cached) { renderInsights(w, el, body, cached); return; }
    if (!(o.display === "number" || w.size === "s")) insSkeleton(body);
    loadInsights(w, el, body, off);
  }
  function insSkeleton(body) {
    const s = body.querySelector(".ins-series"), c = body.querySelector(".ins-chart");
    if (s && !s.childElementCount) s.innerHTML = '<span class="skel skel-chip"></span><span class="skel skel-chip"></span>';
    if (c && !c.childElementCount) c.innerHTML = '<div class="skel skel-chart" aria-hidden="true"></div><p class="sr">Laden…</p>';
    else c?.classList.add("stale");
  }
  async function loadInsights(w, el, body, off) {
    const seq = (insSeq.get(w.id) || 0) + 1; insSeq.set(w.id, seq);
    const key = insKey(w, off);
    try {
      const d = await call("insights", { metric: w.options.insight, period: w.options.period, offset: off, events: !!w.options.events });
      insCache.set(key, d);
      if (insSeq.get(w.id) !== seq || !el.isConnected) return;
      renderInsights(w, el, body, d);
    } catch (e) {
      if (e.code === "auth" || insSeq.get(w.id) !== seq || !el.isConnected) return;
      const msg = e.code === "insights_not_configured" ? "Grafieken nog niet ingericht: draai de workflow Backend in iptv-ios-appletv." : errText(e);
      const c = body.querySelector(".ins-chart") || body.querySelector(".kpi-in .h");
      if (c) { c.classList.remove("stale"); c.innerHTML = `<p class="empty">${esc(msg)}</p>`; }
      const v = body.querySelector(".ins-skel-v"); if (v) v.textContent = "—";
      const sr = body.querySelector(".ins-series"); if (sr) sr.innerHTML = "";
    }
  }
  function insDelta(s, key, period, short = false) {
    const c = s.summary?.change_pct;
    if (c == null) return short ? "" : `<span class="ins-delta flat">geen vergelijking</span>`;
    const up = c > 0, good = c === 0 ? null : up !== (INS_DOWN_GOOD.has(key) || !!s.down);
    const arrow = c === 0 ? "→" : up ? "▲" : "▼";
    return `<span class="ins-delta ${good === null ? "flat" : good ? "good" : "bad"}" title="Ten opzichte van dezelfde tijd ${esc(INS_PREV[period])}">${arrow} ${c > 0 ? "+" : ""}${n1(c)}%${short ? "" : ` <span class="ins-vs">t.o.v. ${esc(INS_PREV[period])}</span>`}</span>`;
  }
  function renderInsights(w, el, body, d) {
    const o = w.options, keys = INS_METRICS[o.insight].series;
    const color = (k) => keys.indexOf(k) + 1;
    const off = new Set(o.off || []);
    const avail = d.series.filter((s) => s.available);
    const shown = avail.filter((s) => !off.has(s.key) || avail.length === 1);
    const mainVal = (s) => (s.summary ? (s.agg === "avg" ? s.summary.avg : s.summary.total) : null);
    if (o.display === "number" || w.size === "s") {
      const s = shown[0] || avail[0];
      const v = body.querySelector(".kpi-in .v"), h = body.querySelector(".kpi-in .h");
      v.classList.remove("ins-skel-v");
      v.textContent = s && mainVal(s) != null ? n1(mainVal(s)) : "—";
      h.innerHTML = s ? `${esc(s.label)}${s.agg === "avg" ? " (gem. per dag)" : ""} · ${esc(insRangeText(d).split(" · ")[0])} ${insDelta(s, s.key, d.period, true)}` : "Geen gegevens in deze periode";
      return;
    }
    body.querySelector(".ins-range").textContent = insRangeText(d);
    const prev = body.querySelector('[data-nav="-1"]'); if (prev) prev.disabled = !d.has_prev;
    const draw = insBody(body, d, {
      keys, off: o.off || [], big: w.size === "l", kind: insDisplay(w, d), gid: `ins-${w.id}`,
      setOff: (arr) => { o.off = arr; saveLayout(); renderInsights(w, el, body, d); },
    });
    dashCharts.push(draw);
  }

  // samenvatting/legenda (.ins-series) en grafiek (.ins-chart) in `body`; geeft de tekenfunctie terug (voor resize).
  // cfg: {keys, off, big, kind, gid, setOff(arr), hooks, onCtl(ctl)}
  function insBody(body, d, cfg) {
    const { keys } = cfg, color = (k) => keys.indexOf(k) + 1, off = new Set(cfg.off);
    const avail = d.series.filter((s) => s.available);
    const shown = avail.filter((s) => !off.has(s.key) || avail.length === 1);
    const mainVal = (s) => (s.summary ? (s.agg === "avg" ? s.summary.avg : s.summary.total) : null);
    // samenvatting per serie; met meer dan één serie zijn het ook de legendaknoppen (aan/uit)
    const multi = avail.length > 1, big = cfg.big && d.series.length < 3;
    const sw = body.querySelector(".ins-series");
    sw.innerHTML = d.series.map((s) => {
      const on = s.available && (!off.has(s.key) || !multi), v = mainVal(s), sm = s.summary;
      const inner = `<span class="ins-key c${color(s.key)}" aria-hidden="true"></span><span class="ins-l">${esc(s.label)}${s.agg === "avg" ? " <small>gem./dag</small>" : ""}</span>
        <span class="ins-v">${!s.available ? '<span class="ins-na">alleen per dag</span>' : v == null ? "—" : esc(sumVal(s, v))}</span>
        ${s.available && sm ? `<span class="ins-d">${insDelta(s, s.key, d.period, !big)}</span>${cfg.big ? `<span class="ins-mm">min ${esc(sumVal(s, sm.min))} · max ${esc(sumVal(s, sm.max))} · gem. ${esc(sumVal(s, sm.avg))}${d.now_index != null && sm.last != null ? ` · nu ${esc(sumVal(s, sm.last))}` : ""}</span>` : ""}` : ""}`;
      return multi
        ? `<button type="button" class="ins-s${on ? " on" : ""}" data-s="${esc(s.key)}" aria-pressed="${on}" ${s.available ? "" : "disabled"} title="${on ? "Verbergen" : "Tonen"} in de grafiek">${inner}</button>`
        : `<div class="ins-s on">${inner}</div>`;
    }).join("");
    sw.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => {
      const k = b.dataset.s, cur = new Set(cfg.off);
      if (cur.has(k)) cur.delete(k);
      else { if (avail.filter((s) => !cur.has(s.key)).length <= 1) { toast("Minstens één serie blijft zichtbaar."); return; } cur.add(k); }
      cfg.setOff(keys.filter((x) => cur.has(x)));
      body.querySelector(`[data-s="${k}"]`)?.focus();
    }));
    const c = body.querySelector(".ins-chart");
    c.classList.remove("stale");
    const draw = () => { const ctl = insChart(c, d, shown, cfg.kind, color, cfg.gid, cfg.hooks); cfg.onCtl?.(ctl); };
    draw();
    return draw;
  }

  // ---- tab Insights: bronnen aanvinken, één gedeelde periode, grafieken onder elkaar met gedeelde crosshair, CSV ----
  const INSP_KEY = KEY + ".insights";
  const insp = (() => {
    const def = { sources: ["accounts", "streams"], period: "7d", events: true, off: {} };
    try {
      const r = JSON.parse(localStorage.getItem(INSP_KEY) || "null");
      if (!isObj(r)) return def;
      const src = Array.isArray(r.sources) ? Object.keys(INS_METRICS).filter((k) => r.sources.includes(k)) : def.sources;
      const off = {};
      if (isObj(r.off)) for (const k of Object.keys(INS_METRICS)) if (Array.isArray(r.off[k])) off[k] = INS_METRICS[k].series.filter((x) => r.off[k].includes(x));
      return { sources: src, period: INS_PERIODS.includes(r.period) ? r.period : def.period, events: r.events !== false, off };
    } catch { return def; }
  })();
  let inspOffset = 0, inspSeq = 0, inspData = {}, inspCtl = {};
  const inspSave = () => { try { localStorage.setItem(INSP_KEY, JSON.stringify(insp)); } catch { /* privé-venster */ } };
  const RES_TEXT = { "5min": "per 5 minuten", hour: "per uur", day: "per dag", week: "per week", month: "per maand" };

  function renderInsSources() {
    $("insSources").innerHTML = Object.entries(INS_METRICS).map(([k, m]) => `<label class="ins-src-it"><input type="checkbox" value="${k}" ${insp.sources.includes(k) ? "checked" : ""}>
      <span class="ins-src-box" aria-hidden="true"></span><span><b>${esc(m.name)}</b><span class="sub">${esc(OPT_LABEL.insight[1][k].split(": ")[1] || "")}</span></span></label>`).join("");
    $("insSources").querySelectorAll("input").forEach((c) => (c.onchange = () => {
      const on = [...$("insSources").querySelectorAll("input:checked")].map((x) => x.value);
      insp.sources = on; inspSave(); loadInsightsPage();
    }));
    $("insPeriods").innerHTML = INS_PERIODS.map((p, i) => `${i === 5 ? '<span class="ins-sep" aria-hidden="true"></span>' : ""}<button type="button" role="radio" data-p="${p}" aria-checked="${p === insp.period}" class="${p === insp.period ? "on" : ""}">${INS_PERIOD_TAB[p]}</button>`).join("");
    $("insPeriods").querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => {
      if (b.dataset.p === insp.period) return;
      insp.period = b.dataset.p; inspOffset = 0; inspSave(); renderInsSources(); loadInsightsPage();
      $("insPeriods").querySelector(`[data-p="${insp.period}"]`)?.focus();
    }));
    $("insEvents").checked = insp.events;
  }
  $("insEvents").onchange = () => { insp.events = $("insEvents").checked; inspSave(); loadInsightsPage(); };
  $("insPrev").onclick = () => { inspOffset--; loadInsightsPage(); };
  $("insNext").onclick = () => { inspOffset = Math.min(0, inspOffset + 1); loadInsightsPage(); if ($("insNext").disabled) $("insPrev").focus(); };
  $("insNow").onclick = () => { inspOffset = 0; loadInsightsPage(); $("insPrev").focus(); };
  $("insRefresh").onclick = () => { insCache.clear(); loadInsightsPage(); };
  $("insCsv").onclick = () => insDownloadCsv();

  function loadInsightsPage() {
    if (!$("insSources").childElementCount) renderInsSources();
    const seq = ++inspSeq, host = $("insCharts");
    $("insNow").disabled = inspOffset === 0; $("insNext").disabled = inspOffset === 0;
    if (!insp.sources.length) {
      host.innerHTML = '<div class="panel ins-none"><h2>Geen bronnen gekozen</h2><p class="sub">Vink links één of meer bronnen aan om ze hier te vergelijken.</p></div>';
      $("insCsv").disabled = true; $("insRange").textContent = INS_PERIOD_TAB[insp.period]; $("insRes").innerHTML = "&nbsp;";
      return;
    }
    // kaarten in vaste volgorde; bestaande kaarten blijven staan (vervaagd) tot de nieuwe gegevens er zijn
    const want = insp.sources;
    host.querySelectorAll(".ins-card").forEach((c) => { if (!want.includes(c.dataset.m)) c.remove(); });
    host.querySelector(".ins-none")?.remove();
    for (const k of want) {
      let card = host.querySelector(`.ins-card[data-m="${k}"]`);
      if (!card) {
        card = document.createElement("article");
        card.className = "panel ins-card"; card.dataset.m = k;
        card.innerHTML = `<div class="ins-card-h"><h2>${esc(INS_METRICS[k].name)}</h2><span class="sub ins-card-res"></span></div><div class="ins-series"></div><div class="ins-chart chart"></div>`;
        insSkeleton(card);
      } else card.querySelector(".ins-chart").classList.add("stale");
      host.appendChild(card); // volgorde
    }
    $("insCsv").disabled = true;
    const q = (k) => {
      const key = `${k}|${insp.period}|${inspOffset}|${insp.events ? 1 : 0}`;
      return insCache.has(key) ? Promise.resolve(insCache.get(key))
        : call("insights", { metric: k, period: insp.period, offset: inspOffset, events: insp.events }).then((d) => { insCache.set(key, d); return d; });
    };
    Promise.allSettled(want.map(q)).then((rs) => {
      if (seq !== inspSeq) return;
      if (rs.some((r) => r.status === "rejected" && r.reason?.code === "auth")) return;
      inspData = {}; inspCtl = {};
      const first = rs.find((r) => r.status === "fulfilled")?.value;
      if (first) {
        $("insRange").textContent = insRangeText(first);
        $("insPrev").disabled = !first.has_prev;
      }
      $("insRes").textContent = [...new Set(rs.filter((r) => r.status === "fulfilled").map((r) => RES_TEXT[r.value.step]))].join(" · ").replace(/^./, (c) => c.toUpperCase()) || " ";
      want.forEach((k, i) => {
        const card = host.querySelector(`.ins-card[data-m="${k}"]`); if (!card) return;
        const r = rs[i];
        if (r.status === "rejected") {
          const msg = r.reason?.code === "insights_not_configured" ? "Grafieken nog niet ingericht: draai de workflow Backend in iptv-ios-appletv." : errText(r.reason);
          card.querySelector(".ins-series").innerHTML = "";
          const c = card.querySelector(".ins-chart"); c.classList.remove("stale"); c.innerHTML = `<p class="empty">${esc(msg)}</p>`;
          return;
        }
        const d = r.value; inspData[k] = d;
        card.querySelector(".ins-card-res").textContent = RES_TEXT[d.step];
        const kind = (d.step === "day" || d.step === "week") && (k === "push" || k === "support") ? "bar" : "line";
        const paint = () => insBody(card, d, {
          keys: INS_METRICS[k].series, off: insp.off[k] || [], big: true, kind, gid: `insp-${k}`,
          setOff: (arr) => { insp.off[k] = arr; inspSave(); paint(); },
          // gedeelde crosshair: hover op één grafiek toont hetzelfde tijdstip op alle grafieken
          hooks: { onShow: (t) => Object.entries(inspCtl).forEach(([m, c]) => { if (m !== k) c.showTime(t); }), onHide: () => Object.entries(inspCtl).forEach(([m, c]) => { if (m !== k) c.hide(); }) },
          onCtl: (ctl) => { inspCtl[k] = ctl; },
        });
        const draw = paint();
        inspDraws.set(k, draw);
      });
      $("insCsv").disabled = !Object.keys(inspData).length;
      $("insLive").textContent = `${$("insRange").textContent}: ${Object.keys(inspData).length} grafieken`;
    });
  }
  const inspDraws = new Map();
  window.addEventListener("resize", () => { clearTimeout(inspResize); inspResize = setTimeout(() => { if (!$("tab-insights").classList.contains("hidden")) inspDraws.forEach((f) => f()); }, 150); });
  let inspResize;

  // CSV van de zichtbare reeksen: alleen tijdvak en aantallen (geen persoonsgegevens); ; als scheidingsteken (Excel NL)
  function insDownloadCsv() {
    const ks = insp.sources.filter((k) => inspData[k]);
    if (!ks.length) return;
    const cols = [];
    for (const k of ks) for (const s of inspData[k].series) if (s.available && !(insp.off[k] || []).includes(s.key)) cols.push([k, s]);
    // één regel per tijdvak (begin + einde); bronnen met een andere resolutie (per uur / per dag) krijgen eigen regels
    const spans = [...new Set(ks.flatMap((k) => inspData[k].edges.slice(0, -1).map((t, i) => `${t}|${inspData[k].edges[i + 1]}`)))].sort();
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [["begin", "einde", ...cols.map(([k, s]) => `${INS_METRICS[k].name} - ${s.label}`)].map(q).join(";")];
    for (const sp of spans) {
      const [a, b] = sp.split("|");
      const row = cols.map(([k, s]) => { const d = inspData[k], i = d.edges.indexOf(a); return i < 0 || d.edges[i + 1] !== b || s.values[i] == null ? "" : String(s.values[i]).replace(".", ","); });
      if (row.every((v) => v === "")) continue;
      lines.push([q(a), q(b), ...row].join(";"));
    }
    const blob = new Blob(["\ufeff" + lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"), first = inspData[ks[0]];
    a.href = URL.createObjectURL(blob);
    a.download = `bingr-insights-${insp.period}-${first.from.slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("CSV gedownload (alleen aantallen per tijdvak).");
  }

  // ---- tab Omzet: Lifetime-aankopen via Stripe (actie revenue), zelfde grafieken en bediening als Insights ----
  // Alleen bedragen (centen) en aantallen per tijdvak; geen gegevens per persoon. Btw volgens Stripe Tax of berekend
  // (tarief in app_settings.revenue_vat); zie supabase/functions/admin/revenue.ts.
  const REV_KEY = KEY + ".revenue";
  const REV_PERIODS = ["day", "week", "month", "year", "7d", "30d"];
  const REV_BUCKETS = { day: ["hour"], week: ["day", "hour"], "7d": ["day", "hour"], month: ["day"], "30d": ["day"], year: ["month", "week"] };
  const REV_BUCKET_TAB = { hour: "Per uur", day: "Per dag", week: "Per week", month: "Per maand" };
  const REV_MONEY = ["gross", "net", "proceeds"], REV_COUNT = ["count", "refund_count"];
  const REV_MODE_TEXT = { "": "Volgens Stripe-sleutel", live: "Live", test: "Test", all: "Live en test" };
  const revp = (() => {
    const def = { period: "month", bucket: "auto", mode: "", kind: "line", off: { money: [], count: [] } };
    try {
      const r = JSON.parse(localStorage.getItem(REV_KEY) || "null");
      if (!isObj(r)) return def;
      const period = REV_PERIODS.includes(r.period) ? r.period : def.period;
      return {
        period, bucket: REV_BUCKETS[period].includes(r.bucket) ? r.bucket : "auto", mode: ["", "live", "test", "all"].includes(r.mode) ? r.mode : "",
        kind: r.kind === "bar" ? "bar" : "line",
        off: { money: Array.isArray(r.off?.money) ? REV_MONEY.filter((k) => r.off.money.includes(k)) : [], count: Array.isArray(r.off?.count) ? REV_COUNT.filter((k) => r.off.count.includes(k)) : [] },
      };
    } catch { return def; }
  })();
  const revSave = () => { try { localStorage.setItem(REV_KEY, JSON.stringify(revp)); } catch { /* privé-venster */ } };
  let revOffset = 0, revSeq = 0, revData = null, revCtl = {};
  const revCache = new Map();
  const revQuery = () => ({ period: revp.period, offset: revOffset, bucket: revp.bucket, ...(revp.mode ? { mode: revp.mode } : {}) });
  const revCacheKey = () => JSON.stringify(revQuery());

  function renderRevControls() {
    $("revPeriods").innerHTML = REV_PERIODS.map((p, i) => `${i === 4 ? '<span class="ins-sep" aria-hidden="true"></span>' : ""}<button type="button" role="radio" data-p="${p}" aria-checked="${p === revp.period}" class="${p === revp.period ? "on" : ""}">${INS_PERIOD_TAB[p]}</button>`).join("");
    $("revPeriods").querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => {
      if (b.dataset.p === revp.period) return;
      revp.period = b.dataset.p; revp.bucket = "auto"; revOffset = 0; revSave(); renderRevControls(); loadRevenue();
      $("revPeriods").querySelector(`[data-p="${revp.period}"]`)?.focus();
    }));
    const bs = REV_BUCKETS[revp.period], cur = revp.bucket === "auto" ? bs[0] : revp.bucket;
    $("revBuckets").classList.toggle("hidden", bs.length < 2);
    $("revBuckets").innerHTML = bs.length < 2 ? "" : bs.map((b) => `<button type="button" role="radio" data-b="${b}" aria-checked="${b === cur}" class="${b === cur ? "on" : ""}">${REV_BUCKET_TAB[b]}</button>`).join("");
    $("revBuckets").querySelectorAll("[data-b]").forEach((b) => (b.onclick = () => {
      if (b.dataset.b === cur) return;
      revp.bucket = b.dataset.b === bs[0] ? "auto" : b.dataset.b; revSave(); renderRevControls(); loadRevenue();
      $("revBuckets").querySelector(`[data-b="${b.dataset.b}"]`)?.focus();
    }));
    $("revMoney").querySelectorAll("[data-k]").forEach((b) => {
      const on = b.dataset.k === revp.kind;
      b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on));
      b.onclick = () => { if (revp.kind === b.dataset.k) return; revp.kind = b.dataset.k; revSave(); renderRevControls(); if (revData) paintRevenue(revData); };
    });
  }
  function renderRevMode(d) {
    const sel = $("revMode");
    sel.innerHTML = Object.entries(REV_MODE_TEXT).map(([k, t]) => {
      const n = d ? (k === "live" ? d.live_count : k === "test" ? d.test_count : k === "all" ? d.live_count + d.test_count : null) : null;
      return `<option value="${k}" ${k === revp.mode ? "selected" : ""}>${esc(t)}${k === "" && d ? ` (${d.mode === "all" ? "alles" : d.mode})` : n != null ? ` (${nf.format(n)})` : ""}</option>`;
    }).join("");
  }
  $("revMode").onchange = () => { revp.mode = $("revMode").value; revSave(); revOffset = 0; loadRevenue(); };
  $("revPrev").onclick = () => { revOffset--; loadRevenue(); };
  $("revNext").onclick = () => { revOffset = Math.min(0, revOffset + 1); loadRevenue(); if ($("revNext").disabled) $("revPrev").focus(); };
  $("revNow").onclick = () => { revOffset = 0; loadRevenue(); $("revPrev").focus(); };
  $("revRefresh").onclick = () => { revCache.clear(); loadRevenue(); };
  $("revCsv").onclick = () => revDownloadCsv();

  async function loadRevenue() {
    if (!$("revPeriods").childElementCount) { renderRevControls(); renderRevMode(null); }
    const seq = ++revSeq, key = revCacheKey();
    $("revNow").disabled = revOffset === 0; $("revNext").disabled = revOffset === 0;
    if (!revData) {
      $("revTiles").innerHTML = ["Deze maand", "Vorige maand", "Dit jaar", "Totaal"].map((l) => `<div class="kpi"><div class="l">${l}</div><div class="v"><span class="skel skel-num"></span></div><div class="h">&nbsp;</div></div>`).join("");
      ["revMoney", "revCount"].forEach((id) => insSkeleton($(id)));
    } else ["revMoney", "revCount"].forEach((id) => $(id).querySelector(".ins-chart").classList.add("stale"));
    try {
      const d = revCache.get(key) || await call("revenue", revQuery());
      revCache.set(key, d);
      if (seq !== revSeq) return;
      revData = d;
      paintRevenue(d);
    } catch (e) {
      if (e.code === "auth" || seq !== revSeq) return;
      const msg = e.code === "revenue_not_configured" ? "Omzet nog niet ingericht: draai de workflow Backend in iptv-ios-appletv." : errText(e);
      $("revTiles").innerHTML = "";
      $("revMain").classList.add("hidden"); $("revBasis").classList.add("hidden");
      $("revEmpty").classList.remove("hidden");
      $("revEmpty").innerHTML = `<h2>Omzet niet beschikbaar</h2><p class="sub">${esc(msg)}</p>`;
      $("revCsv").disabled = true;
    }
  }

  function revTile(label, t, extra = "") {
    return `<div class="kpi rev-tile"><div class="l">${esc(label)}</div><div class="v">${esc(euro(t.gross))}</div>
      <div class="h">netto ${esc(euro(t.net))} · opbrengst <b class="${t.proceeds < 0 ? "neg" : ""}">${esc(euro(t.proceeds))}</b></div>
      <div class="h">${nf.format(t.count)} ${t.count === 1 ? "aankoop" : "aankopen"}${t.refund_count + t.dispute_count ? ` · ${nf.format(t.refund_count + t.dispute_count)} terugbetaald` : ""}${extra}</div></div>`;
  }
  function revSub(d, keys) {
    // InsightsOut-vorm voor insBody/insChart met alleen deze series
    return { ...d, events: [], series: keys.map((k) => d.series.find((s) => s.key === k)).filter(Boolean) };
  }
  function paintRevenue(d) {
    renderRevMode(d);
    const T = d.totals;
    $("revTiles").innerHTML = revTile("Deze maand", T.month) + revTile("Vorige maand", T.prev_month) + revTile("Dit jaar", T.year) + revTile("Totaal", T.all);
    $("revCsv").disabled = d.empty;
    if (d.empty) {
      $("revMain").classList.add("hidden");
      $("revEmpty").classList.remove("hidden");
      $("revEmpty").innerHTML = `<div class="ins-empty rev-none"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.6A4 4 0 0 0 9 11.5v1a4 4 0 0 0 6.5 2.9M7.5 11h5M7.5 13h5"/></svg>
        <h2>Nog geen aankopen</h2><p class="sub">${d.billing.enabled
          ? `Betalen staat aan (${d.billing.mode === "live" ? "live" : "testmodus"}). Zodra iemand Lifetime koopt op bingr.online/upgrade/, verschijnt de omzet hier.${d.mode !== "all" && d.live_count + d.test_count ? ` Er zijn wel ${d.mode === "live" ? "test" : "live"}aankopen: kies hierboven “Live en test”.` : ""}`
          : "Betalen staat uit: er is geen STRIPE_SECRET_KEY (GitHub-secret in iptv-ios-appletv, workflow Backend)."}</p></div>`;
    } else {
      $("revEmpty").classList.add("hidden"); $("revMain").classList.remove("hidden");
    }
    $("revBasis").classList.remove("hidden");
    renderRevBasis(d);
    if (d.empty) return;
    $("revRange").textContent = insRangeText(d);
    $("revRes").textContent = (RES_TEXT[d.step] || "").replace(/^./, (c) => c.toUpperCase());
    $("revPrev").disabled = !d.has_prev;
    $("revCount").querySelector(".ins-card-res").textContent = RES_TEXT[d.step] || "";
    revCtl = {};
    const hooks = (k) => ({ onShow: (t) => Object.entries(revCtl).forEach(([m, c]) => { if (m !== k) c.showTime(t); }), onHide: () => Object.entries(revCtl).forEach(([m, c]) => { if (m !== k) c.hide(); }) });
    const paintMoney = () => insBody($("revMoney"), revSub(d, REV_MONEY), {
      keys: REV_MONEY, off: revp.off.money, big: true, kind: revp.kind, gid: "rev-money",
      setOff: (arr) => { revp.off.money = arr; revSave(); revDraws.money = paintMoney(); }, hooks: hooks("money"), onCtl: (c) => { revCtl.money = c; },
    });
    const paintCount = () => insBody($("revCount"), revSub(d, REV_COUNT), {
      keys: REV_COUNT, off: revp.off.count, big: true, kind: "bar", gid: "rev-count",
      setOff: (arr) => { revp.off.count = arr; revSave(); revDraws.count = paintCount(); }, hooks: hooks("count"), onCtl: (c) => { revCtl.count = c; },
    });
    revDraws.money = paintMoney(); revDraws.count = paintCount();
    renderRevBreak(d);
    revBars($("revMethods"), d.by_method);
    revBars($("revCountries"), d.by_country);
    $("revLive").textContent = `${insRangeText(d)}: bruto ${euro(T.period.gross)}, opbrengst ${euro(T.period.proceeds)}`;
  }
  const revDraws = {};
  window.addEventListener("resize", () => { clearTimeout(revResize); revResize = setTimeout(() => { if (!$("tab-revenue").classList.contains("hidden")) Object.values(revDraws).forEach((f) => f && f()); }, 150); });
  let revResize;

  function renderRevBreak(d) {
    const t = d.totals.period, p = d.totals.prev_period;
    $("revBreakSub").textContent = `${insRangeText(d)} · vorige: ${INS_PREV[d.period]}`;
    const row = (label, a, b, cls = "", hint = "") => `<tr class="${cls}"><th scope="row">${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ""}</th><td>${esc(a)}</td><td>${esc(b)}</td></tr>`;
    const neg = (v) => (v ? `− ${euro(v)}` : euro(0));
    $("revBreak").innerHTML = `<table class="rev-table"><thead><tr><th scope="col"><span class="sr">Post</span></th><th scope="col">Deze periode</th><th scope="col">Vorige</th></tr></thead><tbody>
      ${row("Aankopen", nf.format(t.count), nf.format(p.count))}
      ${row("Bruto omzet", euro(t.gross), euro(p.gross), "", "incl. btw")}
      ${row("Btw", neg(t.vat), neg(p.vat))}
      ${row("Netto omzet", euro(t.net), euro(p.net), "sum", "excl. btw")}
      ${row("Stripe-kosten", neg(t.fees), neg(p.fees), "", t.missing_fees ? `${nf.format(t.missing_fees)} nog onbekend` : "")}
      ${row("Terugbetaald / chargebacks", neg(t.refunds_net), neg(p.refunds_net), "", `excl. btw; incl. btw ${euro(t.refunds)}`)}
      ${row("Netto opbrengst", euro(t.proceeds), euro(p.proceeds), `total${t.proceeds < 0 ? " neg" : ""}`)}</tbody></table>`;
  }
  function revBars(el, rows) {
    if (!rows.length) { el.innerHTML = '<p class="empty">Geen aankopen in deze periode.</p>'; return; }
    const max = Math.max(1, ...rows.map((r) => r.gross));
    el.innerHTML = rows.slice(0, 10).map((r) => `<div class="hbar"><span class="n">${esc(r.label)}</span><span class="t"><span data-w="${Math.max(2, (r.gross / max) * 100).toFixed(1)}"></span></span><span class="c">${esc(euro(r.gross))}<small>${nf.format(r.count)}×</small></span></div>`).join("");
    el.querySelectorAll("span[data-w]").forEach((b) => { b.style.width = `${b.dataset.w}%`; });
  }
  function renderRevBasis(d) {
    const missing = d.totals.all.missing_fees;
    $("revBasis").innerHTML = `<div class="rev-basis-in"><div><b>${esc(d.vat.text)}.</b> <span class="sub">${esc(d.vat.note)}</span>
        <p class="sub">Netto opbrengst = netto omzet − Stripe-kosten − terugbetalingen en chargebacks (excl. btw). Aankopen tellen op de betaaldatum, terugbetalingen op hun eigen datum.</p></div>
      <div class="rev-basis-act">${d.vat.source !== "stripe_tax" ? `<form id="revVatForm" class="rev-vat"><label for="revVat">Btw-tarief</label><input id="revVat" type="number" min="0" max="50" step="0.01" value="${esc(String(d.vat.rate))}" inputmode="decimal"><span>%</span><button class="btn ghost small" type="submit">Opslaan</button></form>` : ""}
      ${missing ? `<p class="sub rev-missing">${nf.format(missing)} ${missing === 1 ? "aankoop" : "aankopen"} zonder Stripe-kosten.</p>${d.billing.enabled ? '<button id="revBackfill" class="btn ghost small" type="button">Kosten ophalen bij Stripe</button>' : ""}` : ""}</div></div>`;
    const f = $("revVatForm");
    if (f) f.onsubmit = async (e) => {
      e.preventDefault();
      const rate = Number(String($("revVat").value).replace(",", "."));
      try { const r = await call("revenue_vat_set", { rate }); toast(`Btw-tarief ${n1(r.rate)}% opgeslagen.`); revCache.clear(); loadRevenue(); }
      catch (err) { if (err.code !== "auth") toast(err.code === "bad_rate" ? "Kies een tarief tussen 0 en 50%." : errText(err), true); }
    };
    const b = $("revBackfill");
    if (b) b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await call("revenue_backfill");
        toast(r.updated ? `Stripe-kosten van ${nf.format(r.updated)} ${r.updated === 1 ? "aankoop" : "aankopen"} opgehaald${r.remaining ? `, nog ${nf.format(r.remaining)}` : ""}.` : "Nog geen nieuwe kosten bij Stripe (soms pas na een paar dagen).");
        revCache.clear(); loadRevenue();
      } catch (err) { if (err.code !== "auth") toast(err.code === "billing_unavailable" ? "Geen STRIPE_SECRET_KEY: kosten ophalen kan niet." : errText(err), true); b.disabled = false; }
    };
  }
  // CSV: per aankoop en terugbetaling alleen datum, soort, bedragen, methode en land (de functie maakt het bestand)
  async function revDownloadCsv() {
    $("revCsv").disabled = true;
    try {
      const r = await call("revenue_export", revQuery());
      const blob = new Blob([r.csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = r.file_name || "bingr-omzet.csv";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast(`CSV gedownload (${nf.format(r.rows)} regels, zonder persoonsgegevens).`);
    } catch (e) { if (e.code !== "auth") toast(errText(e), true); }
    finally { $("revCsv").disabled = !revData || revData.empty; }
  }

  // monotone kubische curve (Fritsch–Carlson, zoals d3.curveMonotoneX) door punten [x, y]
  function monoPath(pts) {
    const n = pts.length;
    if (n < 2) return n ? `M${pts[0][0]},${pts[0][1]}` : "";
    const dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
    let p = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      p += `C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + h * t[i]).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - h * t[i + 1]).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
    }
    return p;
  }
  // hooks: {onShow(tijd), onHide()} voor een gedeelde crosshair (tab Insights); geeft {showTime(tijd), hide()} terug
  function insChart(el, d, shown, kind, color, gid, hooks = {}) {
    const n = d.edges.length - 1, none = { showTime() {}, hide() {} };
    if (!shown.length || !shown.some((s) => s.values.some((v) => v))) {
      el.innerHTML = `<div class="ins-empty"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16M7 15l3-4 3 2 4-6"/></svg><p>Geen gegevens in deze periode</p>${d.has_prev ? '<p class="sub">Blader met ‹ naar een eerdere periode.</p>' : ""}</div>`;
      return none;
    }
    const W = Math.max(260, Math.round(el.clientWidth || 560)), H = Math.max(120, Math.round(el.clientHeight || 200));
    const yw = 34, L = yw, R = 6, T = 10, B = 24, iw = W - L - R, ih = H - T - B, bw = iw / n;
    // ook negatieve waarden (tab Omzet: opbrengst in een tijdvak met alleen een terugbetaling); bedragen in centen
    const vals = shown.flatMap((s) => s.values.filter((v) => v != null)), money = shown.every((s) => s.money);
    const max = Math.max(1, ...vals), lo = Math.min(0, ...vals);
    const step = niceStep(max - lo), top = Math.ceil(max / step) * step, bot = lo < 0 ? -Math.ceil(-lo / step) * step : 0;
    const y = (v) => T + ih - ((v - bot) / (top - bot)) * ih, cx = (i) => L + (i + 0.5) * bw, y0 = y(0);
    let svg = `<defs>${shown.map((s) => `<linearGradient id="${gid}-g${color(s.key)}" class="ins-grad c${color(s.key)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0"/><stop offset="1"/></linearGradient>`).join("")}</defs>`;
    svg += '<g class="ins-grid">';
    for (let v = bot; v <= top + 1e-9; v += step) svg += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"${Math.abs(v) < 1e-9 ? ' class="base"' : ""}/><text x="${L - 8}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${esc(axisVal(money, v))}</text>`;
    svg += "</g><g class=\"ins-x\">";
    for (const [i, t] of insTicks(d, iw)) svg += `<text x="${(kind === "bar" ? cx(i) : cx(i)).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(t)}</text>`;
    svg += "</g>";
    // storingen en onderhoud (statuspagina) als banden op de tijdas, geen lijn; tijd -> x binnen het tijdvak
    const E = d.edges.map((t) => Date.parse(t));
    const tx = (t) => {
      if (t <= E[0]) return L; if (t >= E[n]) return L + iw;
      let i = 0; while (i < n - 1 && t >= E[i + 1]) i++;
      return L + (i + (t - E[i]) / (E[i + 1] - E[i])) * bw;
    };
    const evs = (d.events || []).map((e) => ({ ...e, a: Date.parse(e.from), b: e.to ? Date.parse(e.to) : Math.min(Date.now(), E[n]) }));
    if (evs.length) {
      svg += '<g class="ins-evs">';
      for (const e of evs) {
        const x1 = tx(e.a), x2 = Math.max(x1 + 2, tx(e.b));
        svg += `<rect class="ins-ev ${e.kind}" x="${x1.toFixed(1)}" y="${T}" width="${(x2 - x1).toFixed(1)}" height="${ih}"/><rect class="ins-evm ${e.kind}" x="${x1.toFixed(1)}" y="${T - 4}" width="${(x2 - x1).toFixed(1)}" height="3" rx="1.5"/>`;
      }
      svg += "</g>";
    }
    if (d.now_index != null && d.now_index < n - 1) svg += `<line class="ins-nowline" x1="${(L + (d.now_index + 1) * bw).toFixed(1)}" x2="${(L + (d.now_index + 1) * bw).toFixed(1)}" y1="${T}" y2="${T + ih}"/>`;
    if (kind === "bar") {
      const k = shown.length, gw = Math.min(bw * 0.78, k * 24 + (k - 1) * 2), bwi = Math.max(1, (gw - (k - 1) * 2) / k);
      svg += '<g class="ins-bars">';
      for (let i = 0; i < n; i++) {
        shown.forEach((s, j) => {
          const v = s.values[i]; if (v == null || v === 0) return;
          const x = cx(i) - gw / 2 + j * (bwi + 2), h = Math.max(2, (Math.abs(v) / (top - bot)) * ih), r = Math.min(4, bwi / 2, h), sg = v < 0 ? -1 : 1;
          const tip = y0 - sg * h, rr = sg * r; // afgeronde kant van de staaf weg van de nullijn
          svg += `<path data-i="${i}" class="ins-bar c${color(s.key)}" d="M${x.toFixed(1)},${y0.toFixed(1)} V${(tip + rr).toFixed(1)} Q${x.toFixed(1)},${tip.toFixed(1)} ${(x + r).toFixed(1)},${tip.toFixed(1)} H${(x + bwi - r).toFixed(1)} Q${(x + bwi).toFixed(1)},${tip.toFixed(1)} ${(x + bwi).toFixed(1)},${(tip + rr).toFixed(1)} V${y0.toFixed(1)} Z"/>`;
        });
      }
      svg += "</g>";
    } else {
      // per serie: stukken zonder lege tijdvakken (toekomst, niet bewaard); vlak met kleurverloop + lijn van 2px
      for (const s of shown) {
        const segs = []; let cur = [];
        s.values.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([cx(i), y(v)]); });
        if (cur.length) segs.push(cur);
        for (const sg of segs) {
          const line = monoPath(sg);
          svg += `<path class="ins-area" fill="url(#${gid}-g${color(s.key)})" d="${line}L${sg[sg.length - 1][0].toFixed(1)},${y0.toFixed(1)}L${sg[0][0].toFixed(1)},${y0.toFixed(1)}Z"/>`;
          svg += `<path class="ins-line c${color(s.key)}" d="${line}"/>`;
          if (sg.length === 1) svg += `<circle class="ins-dot c${color(s.key)}" cx="${sg[0][0]}" cy="${sg[0][1]}" r="3"/>`;
        }
      }
    }
    svg += `<g class="ins-cross hidden"><line class="ins-crossline" y1="${T}" y2="${T + ih}"/>${kind === "bar" ? "" : shown.map((s) => `<circle class="ins-pt c${color(s.key)}" r="4.5" data-k="${esc(s.key)}"/>`).join("")}</g>`;
    svg += `<rect class="ins-hit" x="${L}" y="${T}" width="${iw}" height="${ih}" tabindex="0" role="slider" aria-label="Waarden per tijdvak (pijltjestoetsen)" aria-valuemin="0" aria-valuemax="${n - 1}" aria-valuenow="0"/>`;
    // tabel voor schermlezers (zelfde waarden als de grafiek)
    const table = `<div class="sr"><table><caption>${esc(insRangeText(d))}</caption><thead><tr><th>Tijd</th>${shown.map((s) => `<th>${esc(s.label)}</th>`).join("")}</tr></thead><tbody>${
      [...Array(n).keys()].filter((i) => shown.some((s) => s.values[i] != null)).map((i) => `<tr><td>${esc(insBucketText(d, i))}</td>${shown.map((s) => `<td>${esc(fmtVal(s, s.values[i]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${svg}</svg><div class="tip ins-tip hidden" role="status"></div>${table}`;
    const root = el.querySelector("svg"), hit = root.querySelector(".ins-hit"), cross = root.querySelector(".ins-cross"), tip = el.querySelector(".ins-tip");
    const xl = cross.querySelector("line");
    let shownI = -1, hideTimer;
    const show = (i, sync = false) => {
      i = Math.max(0, Math.min(n - 1, i)); if (i === shownI) return; shownI = i;
      if (!sync) hooks.onShow?.((E[i] + E[i + 1]) / 2);
      const x = cx(i);
      xl.setAttribute("x1", x); xl.setAttribute("x2", x); cross.classList.remove("hidden");
      cross.querySelectorAll(".ins-pt").forEach((p) => {
        const v = shown.find((s) => s.key === p.dataset.k)?.values[i];
        p.classList.toggle("hidden", v == null);
        if (v != null) { p.setAttribute("cx", x); p.setAttribute("cy", y(v)); }
      });
      root.querySelectorAll(".ins-bar").forEach((b) => b.classList.toggle("dim", Number(b.dataset.i) !== i));
      const here = evs.filter((e) => e.a < E[i + 1] && e.b > E[i]);
      tip.innerHTML = `<div class="ins-tt">${esc(insBucketText(d, i))}</div>${shown.map((s) => `<div class="ins-tr"><span class="ins-tk c${color(s.key)}"></span><b>${esc(fmtVal(s, s.values[i]))}</b><span>${esc(s.label)}</span></div>`).join("")}${
        here.slice(0, 3).map((e) => `<div class="ins-te ${e.kind}"><span class="ins-ek" aria-hidden="true"></span>${e.kind === "maintenance" ? "Onderhoud" : "Storing"}: ${esc(e.name || "onbekend")}</div>`).join("")}`;
      tip.classList.remove("hidden");
      const sx = root.getBoundingClientRect().width / W || 1, tw = tip.offsetWidth, cw = el.clientWidth;
      const px = x * sx, left = Math.max(0, Math.min(cw - tw, px + 14 > cw - tw ? px - tw - 14 : px + 14));
      tip.style.left = `${left}px`; tip.style.top = `${T * sx}px`;
      hit.setAttribute("aria-valuenow", String(i)); hit.setAttribute("aria-valuetext", tip.textContent);
    };
    const hide = (sync = false) => { if (!sync && shownI >= 0) hooks.onHide?.(); shownI = -1; cross.classList.add("hidden"); tip.classList.add("hidden"); root.querySelectorAll(".ins-bar.dim").forEach((b) => b.classList.remove("dim")); };
    const idx = (e) => { const r = root.getBoundingClientRect(); return Math.floor(((e.clientX - r.left) * (W / r.width) - L) / bw); };
    hit.addEventListener("pointermove", (e) => { clearTimeout(hideTimer); show(idx(e)); });
    hit.addEventListener("pointerdown", (e) => { clearTimeout(hideTimer); show(idx(e)); });
    hit.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
    hit.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 2500); } });
    hit.addEventListener("pointercancel", () => hide());
    hit.addEventListener("blur", () => hide());
    hit.addEventListener("keydown", (e) => {
      const last = d.now_index ?? n - 1;
      const k = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (k) { e.preventDefault(); show(shownI < 0 ? last : shownI + k); }
      else if (e.key === "Home") { e.preventDefault(); show(0); } else if (e.key === "End") { e.preventDefault(); show(last); }
      else if (e.key === "Escape") hide();
    });
    return {
      showTime(t) { const i = E.findIndex((x, j) => j < n && t >= x && t < E[j + 1]); if (i < 0) hide(true); else show(i, true); },
      hide() { hide(true); },
    };
  }

  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (!$("tab-overview").classList.contains("hidden")) dashCharts.forEach((f) => f()); }, 150); });
  function niceStep(max) {
    const raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) if (m * p >= raw) return Math.max(1, m * p);
    return Math.max(1, 10 * p);
  }
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
      <td class="em">${fullName(u) ? `<span class="u-name">${esc(fullName(u))}</span><span class="u-mail">${esc(u.email)}</span>` : esc(u.email)}${u.confirmed ? "" : ' <span class="chip warn">onbevestigd</span>'}${u.newsletter === false ? ' <span class="chip" title="Krijgt de nieuwsbrief niet (afgemeld of alle mail uit)">Geen nieuwsbrief</span>' : ""}${u.blocked
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

  // naam van een account (user_metadata first_name / last_name), of "" als die niet bekend is
  const fullName = (u) => [u?.first_name, u?.last_name].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
  const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

  async function openUser(id) {
    $("drawerBody").innerHTML = '<p class="sub">Laden…</p>';
    openDrawer();
    let u;
    try { u = await call("user_detail", { id }); } catch (e) { if (e.code !== "auth") $("drawerBody").innerHTML = `<p class="err">${esc(errText(e))}</p>`; return; }
    const b = u.block, hist = (u.blocks || []).filter((x) => !b || x.id !== b.id);
    const mailHint = smtpOk ? "" : '<p class="sub">E-mail is niet ingesteld op de server; er gaat geen mail uit.</p>';
    $("drawerBody").innerHTML = `
      <h2 id="dTitle">${esc(fullName(u) || u.email)}${b ? ' <span class="chip bad">Geblokkeerd</span>' : ""}</h2>
      <p class="u-sub"><span id="uMail" class="u-mail">${esc(u.email)}</span>
        <button id="uEye" class="eye" type="button" aria-pressed="false" aria-label="Volledig e-mailadres tonen" title="Volledig e-mailadres tonen">${EYE}</button></p>
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
        <dt>Naam</dt><dd><span id="uName">${esc(fullName(u) || "—")}</span><button id="nameOpen" class="name-edit" type="button" aria-expanded="false" aria-controls="nameForm">Wijzig</button></dd>
        <dt>Aangemaakt</dt><dd>${esc(fmtDateTime(u.created_at))}</dd>
        <dt>Laatst ingelogd</dt><dd>${esc(u.last_sign_in_at ? fmtDateTime(u.last_sign_in_at) : "nooit")}</dd>
        <dt>Bevestigd</dt><dd>${u.confirmed ? "Ja" : "Nee"}</dd>
        <dt>Taal</dt><dd>${esc(u.lang || "—")}</dd>
        <dt>Profielen</dt><dd>${nf.format(u.profile_count || 0)}</dd>
        <dt>Actief (30 d)</dt><dd>${nf.format(u.active_days_30d || 0)} dagen</dd>
        <dt>Kijkt nu</dt><dd>${nf.format(u.watching_now || 0)}</dd>
        <dt>Berichten per e-mail</dt><dd>${u.email_opt_out ? "Afgemeld" : "Aan"}</dd>
        <dt>Nieuwsbrief</dt><dd id="uNl"></dd>
      </dl>
      <form id="nameForm" class="name-form hidden" novalidate>
        <h3>Naam wijzigen</h3>
        <div class="plan-nums">
          <label>Voornaam<input id="nFirst" maxlength="50" autocomplete="off" value="${esc(u.first_name || "")}"></label>
          <label>Achternaam<input id="nLast" maxlength="50" autocomplete="off" value="${esc(u.last_name || "")}"></label>
        </div>
        <p class="sub">Leeg = geen naam. De voornaam staat in de aanhef van de mails ("Hoi …,").</p>
        <div id="nErr" class="err" role="alert"></div>
        <div class="form-btns"><button id="nSave" class="btn" type="submit">Naam opslaan</button><button id="nCancel" class="btn ghost" type="button">Annuleren</button></div>
      </form>
      ${planSection(u)}
      <h3>Apparaten (${(u.devices || []).length})</h3>
      ${(u.devices || []).map((d) => `<div class="dev"><div class="ic">${icon(d.platform)}</div><div>
        <div class="nm">${esc(d.name || pname(d.platform))}</div>
        <div class="meta">${esc(pname(d.platform))}${d.app_version ? " · Bingr " + esc(d.app_version) : ""}${d.os_version ? " · " + esc(d.os_version) : ""}</div>
        <div class="meta">Laatst gezien ${esc(ago(d.last_seen_at))} · gekoppeld ${esc(fmtDate(d.created_at))}</div></div></div>`).join("") || '<p class="empty">Geen apparaten.</p>'}
      ${serversSection(u.servers)}
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
        <p class="sub">Verwijdert het account met profielen, apparaten en sessies, instellingen, servers, kijkgeschiedenis, statistieken en verzamelingen. Dit kan niet ongedaan worden gemaakt. De klant kan daarna altijd een nieuw account maken. Aankopen blijven zonder koppeling aan het account 7 jaar bewaard (fiscale bewaarplicht) en tellen mee in Omzet.</p>
        <label class="switch"><input id="dNotify" type="checkbox" ${smtpOk ? "checked" : "disabled"}><span class="track"></span><span>Bevestiging mailen vanaf support@bingr.online</span></label>
        <label class="switch"><input id="dTickets" type="checkbox"><span class="track"></span><span>Ook supporttickets verwijderen <span class="sub">(standaard bewaard, los van het account)</span></span></label>
        <label>Interne notitie <span class="sub">optioneel, alleen in het logboek</span><input id="dReason" maxlength="500" autocomplete="off"></label>
        <label>Typ het e-mailadres ter bevestiging <span class="sub">volledig, of precies zoals hierboven: ${esc(u.email)}</span>
          <input id="dConfirm" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="email"></label>
        <div id="dErr" class="err" role="alert"></div>
        <div class="form-btns"><button id="dBtn" class="btn danger-solid" disabled>Account definitief verwijderen</button></div>
      </section>`;
    wireEmailEye(u);
    wireName(u);
    wireNewsletter(u);
    wireServers();
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
  // servers van dit account (user_detail.servers): alleen het adres van Xtream-bronnen (schema + host + poort), de naam die de
  // klant gaf en of het de actieve bron is. Nooit inloggegevens; M3U en andere soorten staan er niet in. null = onbekend.
  const SERVER_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>';
  function serversSection(list) {
    if (list == null) return '<h3>Servers</h3><p class="empty">Servers konden niet worden gelezen.</p>';
    const rows = list.map((s, i) => `<div class="dev srv"><div class="ic">${SERVER_IC}</div><div class="srv-b">
        <div class="nm">${esc(s.name || "Zonder naam")}${s.active ? ' <span class="chip on">actief</span>' : ""}</div>
        <div class="srv-row"><code class="srv-host">${esc(s.host)}</code>
          <button class="btn small ghost" type="button" data-srv="${i}" aria-label="Adres ${esc(s.host)} kopiëren">Kopiëren</button></div></div></div>`).join("");
    return `<h3>Servers (${list.length})</h3><div id="uServers" class="srv-list">${rows || '<p class="empty">Geen Xtream-servers.</p>'}</div>
      <p class="sub">Alleen het serveradres van Xtream-bronnen; geen gebruikersnaam, wachtwoord of afspeellijsten.</p>`;
  }
  function wireServers() {
    const box = $("uServers");
    if (!box) return;
    box.querySelectorAll("button[data-srv]").forEach((b) => (b.onclick = async () => {
      const host = b.closest(".srv").querySelector(".srv-host").textContent;
      try { await navigator.clipboard.writeText(host); toast("Adres gekopieerd."); }
      catch {
        const r = document.createRange(); r.selectNodeContents(b.closest(".srv").querySelector(".srv-host"));
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
        toast("Selecteer het adres en kopieer het.", true);
      }
    }));
  }
  // nieuwsbrief van dit account (user_detail.newsletter, actie user_newsletter_set). Heeft de klant alle mail uitgezet
  // (email_opt_out), dan alleen de stand: dat zet alleen de klant zelf terug. null = onbekend (kolom nog niet aangemaakt).
  function wireNewsletter(u) {
    const el = $("uNl"), n = u.newsletter;
    if (!n) { el.innerHTML = '<span class="sub">Onbekend</span>'; return; }
    if (n.email_opt_out) { el.innerHTML = 'Geen e-mail (alles uitgezet) <span class="sub">alleen de klant kan dit weer aanzetten</span>'; return; }
    el.innerHTML = `<label class="switch nl-user"><input id="uNlSw" type="checkbox" role="switch"${n.subscribed ? " checked" : ""}><span class="track"></span><span id="uNlTxt">${n.subscribed ? "Geabonneerd" : "Afgemeld"}</span></label>`;
    const sw = $("uNlSw");
    sw.onchange = async () => {
      const on = sw.checked;
      sw.disabled = true;
      try {
        const r = await call("user_newsletter_set", { id: u.id, subscribed: on });
        u.newsletter = r.newsletter || { ...n, subscribed: on, newsletter_opt_out: !on };
        $("uNlTxt").textContent = u.newsletter.subscribed ? "Geabonneerd" : "Afgemeld";
        sw.checked = !!u.newsletter.subscribed;
        toast(u.newsletter.subscribed ? "Nieuwsbrief aangezet voor dit account." : "Nieuwsbrief uitgezet voor dit account.");
        if (loaded.users) loadUsers();
      } catch (e) { sw.checked = !on; if (e.code !== "auth") toast(errText(e), true); }
      finally { sw.disabled = false; }
    };
  }
  // oog naast het gemaskeerde adres: na een klik het volledige adres (actie user_email, in het logboek), opnieuw = verbergen.
  // Het adres blijft alleen in deze lade (niet opgeslagen); bij een andere gebruiker of opnieuw openen is het weer gemaskeerd.
  function wireEmailEye(u) {
    let full = null;
    const btn = $("uEye");
    const show = (on) => {
      $("uMail").textContent = on ? full : u.email;
      btn.setAttribute("aria-pressed", String(on));
      const l = on ? "E-mailadres verbergen" : "Volledig e-mailadres tonen";
      btn.setAttribute("aria-label", l); btn.title = l;
      btn.innerHTML = on ? EYE_OFF : EYE;
    };
    btn.onclick = async () => {
      if (btn.getAttribute("aria-pressed") === "true") { show(false); return; }
      if (full === null) {
        btn.disabled = true;
        try { full = (await call("user_email", { id: u.id })).email || ""; }
        catch (e) { if (e.code !== "auth") toast(errText(e), true); return; }
        finally { btn.disabled = false; }
      }
      show(true);
    };
  }
  // naam wijzigen (actie user_set_name): voor- en achternaam, leeg = geen naam
  function wireName(u) {
    const form = $("nameForm"), open = $("nameOpen");
    const toggle = (on) => {
      form.classList.toggle("hidden", !on); open.setAttribute("aria-expanded", String(on));
      if (on) { $("nFirst").focus(); form.scrollIntoView({ block: "nearest", behavior: "smooth" }); } else open.focus();
    };
    open.onclick = () => toggle(form.classList.contains("hidden"));
    $("nCancel").onclick = () => { $("nFirst").value = u.first_name || ""; $("nLast").value = u.last_name || ""; $("nErr").textContent = ""; toggle(false); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const first_name = $("nFirst").value.replace(/\s+/g, " ").trim(), last_name = $("nLast").value.replace(/\s+/g, " ").trim();
      if ([...first_name].length > 50 || [...last_name].length > 50) { $("nErr").textContent = ERR.name_too_long; return; }
      if (/[<>]/.test(first_name + last_name)) { $("nErr").textContent = ERR.bad_name; return; }
      $("nSave").disabled = true; $("nErr").textContent = "";
      try {
        await call("user_set_name", { id: u.id, first_name, last_name });
        toast(first_name || last_name ? "Naam opgeslagen." : "Naam verwijderd.");
        refreshUserViews(u.id);
      } catch (err) { if (err.code !== "auth") $("nErr").textContent = errText(err); $("nSave").disabled = false; }
    };
  }
  // ---- abonnement in de lade: Gratis/Lifetime, eigen limieten (leeg = standaard) en een interne notitie
  function planSection(u) {
    const p = planObj(u.plan), life = p.plan === "lifetime";
    const src = p.source === "purchase" && p.purchased_at ? purchaseText(p) : p.source ? (PLAN_SOURCE[p.source] || p.source) : "";
    // build 133: aankopen via Stripe (datum, bedrag, status); terugbetalen gaat in het Stripe-dashboard
    const buys = Array.isArray(u.purchases) ? u.purchases.filter((b) => b.status !== "failed") : [];
    const buyList = buys.length ? `<p class="sub">Aankopen: ${buys.map((b) => esc(`${fmtDate(b.paid_at || b.created_at)} ${euro(b.amount)} (${PURCHASE_STATUS[b.status] || b.status}${b.refunded_at ? " " + fmtDate(b.refunded_at) : ""})`)).join(" · ")}. Terugbetalen in het Stripe-dashboard; het account gaat dan vanzelf naar Gratis.</p>` : "";
    return `<section class="plan-box" aria-labelledby="plTitle">
      <h3 id="plTitle">Abonnement ${planChip(p)}</h3>
      <p class="sub">${life ? `Lifetime${src ? ", " + esc(src) : ""}${p.updated_at && p.source !== "purchase" ? " · " + esc(fmtDate(p.updated_at)) : ""}` : "Gratis: 1 tegelijk kijken, 8 apparaten, 1 server, zonder statistieken, nu aan het kijken, Trakt en thema's."}</p>${buyList}
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
      if (was === "lifetime" && plan === "free" && !confirm(`${u.email} terugzetten naar Gratis? Statistieken, nu aan het kijken, Trakt en thema's gaan dan op slot.${planObj(u.plan).source === "purchase" ? " Let op: deze Lifetime is gekocht; het geld wordt zo niet terugbetaald (dat gaat in het Stripe-dashboard)." : ""}`)) return;
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
  // (ook vanuit het menu rechtsboven)
  async function logoutAll() {
    if (!confirm("Overal uitloggen? Alle sessies van het beheer (ook in de app en in andere browsers) vervallen meteen.")) return;
    $("logoutAll").disabled = true;
    try { await call("logout_all"); logout("Je bent overal uitgelogd."); }
    catch (e) { if (e.code !== "auth") toast(errText(e), true); }
    finally { $("logoutAll").disabled = false; }
  }
  $("logoutAll").onclick = logoutAll;

  // ---- downloads: buildpakketten op de server van beheer.bingr.online (acties builds / build_link) ----
  // De pakketten staan niet op GitHub; een download loopt via dl.php met een link van 10 minuten uit de functie admin.
  const DL_PLATFORMS = [
    ["android", "Android en Android TV", "APK voor telefoons, tablets, Android TV, Google TV en Fire TV"],
    ["tizen", "Samsung TV", ".wgt voor Tizen"],
    ["apple", "Apple", "Xcode-project (zip) voor iOS, iPadOS, tvOS en macOS"],
    ["beheer", "BingrBeheer", "Xcode-project (zip) van deze beheer-app voor iPhone en iPad"],
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
  // tijd van uploaden (uploaded_at, workflow Builds) als datum en tijd in NL-tijd; oudere builds: alleen date (zonder tijd)
  const dlDate = (b) => (typeof b.uploaded_at === "string" && !Number.isNaN(Date.parse(b.uploaded_at))
    ? new Date(b.uploaded_at).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : typeof b.date === "string" && b.date ? fmtDate(/^\d{4}-\d{2}-\d{2}$/.test(b.date) ? `${b.date}T12:00:00` : b.date) : "—");
  function dlButton(p, b, ghost) {
    return `<button class="btn small${ghost ? " ghost" : ""}" type="button" data-dl-p="${esc(p)}" data-dl-f="${esc(b.file)}">Downloaden</button>`;
  }
  // releasemelding per build (apple/android): niet meer automatisch, want de stores keuren pas later goed; hier per
  // build met de hand versturen (actie build_push, één keer per build)
  const DL_PUSH = { apple: "iPhone, iPad en Mac", android: "Android-telefoons en -tablets" };
  let dlPush = {};
  function dlPushInfo(p, b, compact) {
    if (!DL_PUSH[p] || b.build == null || b.build === "") return "";
    const st = dlPush[`${p}:${b.build}`];
    if (st) {
      const nums = [`${st.devices} apparaten`, st.sent ? `${st.sent} verstuurd` : "", st.failed ? `${st.failed} mislukt` : "", !st.done && st.queued ? `${st.queued} in wachtrij` : ""].filter(Boolean).join(", ");
      return `<span class="chip bld-push-sent" title="${esc(`Pushmelding verstuurd ${fmtDateTime(st.sent_at)}: ${nums}`)}">Push verstuurd${compact ? "" : ` ${esc(fmtDateTime(st.sent_at))} · ${esc(nums)}`}</span>`;
    }
    return `<button class="btn small${compact ? " ghost" : ""}" type="button" data-push-p="${esc(p)}" data-push-f="${esc(b.file)}" data-push-b="${esc(b.build)}">Pushmelding versturen</button>`;
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
      <div class="form-btns">${dlButton(p, b, false)}${dlPushInfo(p, b, false)}</div>
      ${DL_PUSH[p] ? `<p class="sub bld-push-hint">Pushmelding pas versturen als deze build in de stores staat. Alleen apparaten met een oudere build krijgen hem, één keer per build.</p>` : ""}
      ${hist.length ? `<div class="bld-hist"><div class="sub">Oudere builds</div><ul>${hist.map((h) => `<li><span><b>${esc(dlBuild(h))}</b>
        <span class="sub">${esc([h.version, dlDate(h), fmtSize(h.size)].filter((x) => x && x !== "—").join(" · "))}</span></span><span class="bld-hist-btns">${dlPushInfo(p, h, true)}${dlButton(p, h, true)}</span></li>`).join("")}</ul></div>` : ""}
    </div>`;
  }
  // PressKit (workflow PressKit): openbare download via bingr.online/presskit; teller uit builds/presskit-stats.json (alleen aantallen)
  function pkCard(b, pk) {
    if (!b) return "";
    const st = pk?.stats || null, url = pk?.public_url || "https://bingr.online/presskit";
    const days = st?.days || [], max = Math.max(1, ...days.map((d) => d.n));
    const num = (v) => (st ? nf.format(v ?? 0) : "—");
    const dayLabel = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short", timeZone: "Europe/Amsterdam" });
    return `<div class="panel bld-card pk-card">
      <div class="bld-head"><div><h2>PressKit</h2><p class="sub">Persmap voor bingr.online: logo, app-iconen en App Store-screenshots (Bingr-PressKit.zip)</p></div><span class="chip">versie ${esc(b.version || "—")}</span></div>
      <div class="pk-cols">
        <dl class="dl">
          <dt>Versie</dt><dd>${esc(b.version || "—")}</dd>
          <dt>Datum</dt><dd>${esc(dlDate(b))}</dd>
          <dt>Grootte</dt><dd>${esc(fmtSize(b.size))}</dd>
          <dt>Bestand</dt><dd class="brk">${esc(b.file)}</dd>
          ${b.sha256 ? `<dt>SHA-256</dt><dd class="brk bld-hash">${esc(b.sha256)}</dd>` : ""}
        </dl>
        <div class="pk-stats">
          <div class="pk-nums">
            <div><b>${num(st?.total)}</b><span>Downloads totaal</span></div>
            <div><b>${num(st?.version_total)}</b><span>Deze versie</span></div>
            <div><b>${num(st?.last_7d)}</b><span>Laatste 7 dagen</span></div>
            <div><b>${num(st?.last_30d)}</b><span>Laatste 30 dagen</span></div>
          </div>
          ${st ? `<div class="pk-spark" role="img" aria-label="${esc(`Downloads per dag, laatste 30 dagen: ${nf.format(st.last_30d)} in totaal`)}">${days.map((d) => `<i data-h="${(d.n / max * 100).toFixed(1)}" title="${esc(`${dayLabel(d.date)}: ${d.n}`)}"></i>`).join("")}</div>
            <div class="pk-axis sub"><span>${esc(dayLabel(days[0]?.date || ""))}</span><span>vandaag</span></div>`
            : `<p class="sub">Nog geen tellingen (teller nog niet op de server).</p>`}
        </div>
      </div>
      <label class="pk-link"><span class="sub">Openbare link (zonder inloggen; telt als download)</span>
        <span class="pk-link-row"><input id="pkUrl" type="text" readonly value="${esc(url)}"><button id="pkCopy" class="btn small ghost" type="button">Kopiëren</button></span></label>
      <div class="form-btns">${dlButton("presskit", b, false)}</div>
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
    dlPush = r.release_push && typeof r.release_push === "object" ? r.release_push : {};
    el.innerHTML = DL_PLATFORMS.map((x) => dlCard(x, r.platforms[x[0]])).join("") + pkCard(r.platforms.presskit, r.presskit);
    el.querySelectorAll(".pk-spark i[data-h]").forEach((i) => { i.style.height = `${Math.max(2, Number(i.dataset.h))}%`; });
    const pkCopy = $("pkCopy");
    if (pkCopy) pkCopy.onclick = async () => {
      const inp = $("pkUrl");
      try { await navigator.clipboard.writeText(inp.value); toast("Link gekopieerd."); }
      catch { inp.select(); toast("Selecteer de link en kopieer hem.", true); }
    };
    el.querySelectorAll("button[data-dl-p]").forEach((b) => (b.onclick = () => download(b)));
    el.querySelectorAll("button[data-push-p]").forEach((b) => (b.onclick = () => releasePush(b)));
  }
  async function releasePush(btn) {
    const p = btn.dataset.pushP, build = btn.dataset.pushB;
    if (!confirm(`Pushmelding "Bingr build ${build} is beschikbaar" versturen naar ${DL_PUSH[p]} met een oudere build?\n\nDoe dit pas als build ${build} goedgekeurd is en in de stores staat. Dit kan maar één keer per build.`)) return;
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = "Versturen…";
    try {
      const r = await call("build_push", { platform: p, file: btn.dataset.pushF });
      const miss = (r.missing_channels || []).map((c) => PUSH_NOTE[c] || c);
      if (r.duplicate) toast(`De pushmelding voor build ${r.build} was al eerder verstuurd.`);
      else toast(`Pushmelding build ${r.build} verstuurd naar ${r.devices ?? 0} apparaten.${miss.length ? ` Let op: ${miss.join(", ")}.` : ""}`, miss.length > 0);
      if (r.push) dlPush[`${p}:${r.build}`] = r.push;
      loadDownloads();
      loaded.messages = false; // geschiedenis van Pushmeldingen opnieuw laden
    } catch (e) {
      if (e.code === "build_not_found") loadDownloads();
      if (e.code !== "auth") toast(errText(e), true);
      btn.disabled = false; btn.textContent = old;
    }
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
    const u = c.unread || 0, txt = u > 99 ? "99+" : String(u);
    // teller bij Support in het menu en als badge op het hamburgericoon (voor de screenreader in het label van de knop)
    const mb = $("menuSupBadge");
    mb.textContent = txt; mb.classList.toggle("hidden", !u);
    mb.setAttribute("aria-label", `${u} ongelezen`);
    const dot = $("menuDot");
    dot.textContent = txt; dot.classList.toggle("hidden", !u);
    menuBtn.setAttribute("aria-label", u ? `Menu, ${u} ongelezen in Support` : "Menu");
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

  // ---- pushmeldingen (tab "messages"; contract docs/PUSH.md in iptv-ios-appletv) ----
  // Versturen via push_send (functie admin -> push), voortgang via push_progress, geschiedenis via push_history.
  // Alleen pushmeldingen (de oude berichten per e-mail en de in-app banner zijn weg); bovenaan de pushabonnees.
  let smtpOk = true, pvLang = "nl", sending = false, phPage = 0;
  const PUSH_PF = { ios: "iPhone", ipados: "iPad", macos: "Mac", android: "Android", web: "Web" };
  const PUSH_GROUP = { apple: "Apple (iPhone, iPad, Mac)", android: "Android" };
  const PUSH_KIND = { release: ["Release", "rel"], admin: ["Beheer", "adm"], reminder: ["Herinnering", "rem"] };
  const PUSH_NOTE = {
    apns_not_configured: "APNs (Apple) niet ingesteld", fcm_not_configured: "FCM (Android) niet ingesteld",
    webpush_not_configured: "Web Push niet ingesteld", vapid_not_configured: "Web Push niet ingesteld",
  };
  const accSel = new Map(); // id -> label (naam en gemaskeerd e-mailadres, zoals op de pagina Gebruikers)
  Object.assign(ERR, {
    push_not_configured: "Pushmeldingen zijn nog niet ingesteld (PUSH_ADMIN_SECRET; workflow Backend in iptv-ios-appletv draaien).",
    push_not_deployed: "De functie push staat nog niet online (workflow Backend in iptv-ios-appletv draaien).",
    push_forbidden: "De functie push weigerde de aanvraag (PUSH_ADMIN_SECRET klopt niet).",
    push_unreachable: "De functie push is niet bereikbaar. Probeer het later opnieuw.",
    title_too_long: "De titel is te lang (max. 100 tekens).", body_too_long: "De tekst is te lang (max. 600 tekens).",
    en_incomplete: "Vul bij Engels zowel titel als tekst in (of laat beide leeg).", text_too_large: "De tekst is te lang voor een pushmelding.",
    bad_link: "De link moet met https:// beginnen en naar een echte website gaan.", bad_target: "Kies een doelgroep.",
    no_accounts: "Kies minstens één account.", too_many_accounts: "Kies hoogstens 500 accounts.", bad_account: "Ongeldig account in de lijst.",
    no_platforms: "Kies minstens één platform.", no_push_platform: "Apple TV, Android TV en Samsung TV hebben geen systeem-push.",
  });
  const pushTitle = (m) => (m.kind === "release" ? `Bingr ${m.version || ""} (Build ${m.build ?? "?"}) is beschikbaar` : m.title || (m.kind === "reminder" ? "Programmaherinnering" : "—"));

  const targetMode = () => document.querySelector('input[name="pTarget"]:checked')?.value || "all";
  function preview() {
    const en = pvLang === "en" && $("tEn").value.trim() && $("bEn").value.trim();
    $("pvTitle").textContent = (en ? $("tEn") : $("tNl")).value.trim() || "Titel";
    $("pvBody").textContent = (en ? $("bEn") : $("bNl")).value.trim() || "Tekst van de melding";
    let host = "";
    try { const u = new URL($("pUrl").value.trim()); if (u.protocol === "https:") host = u.hostname; } catch { /* geen link */ }
    $("pvLink").textContent = host ? `Opent ${host}` : "";
    $("pvLink").classList.toggle("hidden", !host);
  }
  ["tNl", "bNl", "tEn", "bEn", "pUrl"].forEach((id) => $(id).addEventListener("input", preview));
  document.querySelectorAll("#pvSeg button").forEach((b) => (b.onclick = () => {
    pvLang = b.dataset.lang; document.querySelectorAll("#pvSeg button").forEach((x) => x.classList.toggle("on", x === b)); preview();
  }));
  document.querySelectorAll('input[name="pTarget"]').forEach((r) => (r.onchange = () => {
    const m = targetMode();
    $("pAccounts").classList.toggle("hidden", m !== "accounts");
    $("pPlatforms").classList.toggle("hidden", m !== "platforms");
    if (m === "accounts") $("pAccQ").focus();
  }));

  // doelgroep: accounts zoeken zoals op de pagina Gebruikers (actie users met q), meerdere kiezen
  let accTimer, accSeq = 0;
  function renderAccSel() {
    $("pAccSel").innerHTML = accSel.size
      ? [...accSel].map(([id, l]) => `<span class="acc-chip" data-id="${esc(id)}">${esc(l)}<button type="button" aria-label="${esc(l)} weghalen">×</button></span>`).join("")
        + `<span class="sub">${nf.format(accSel.size)} ${accSel.size === 1 ? "account" : "accounts"} gekozen</span>`
      : '<span class="sub">Nog geen accounts gekozen.</span>';
    $("pAccSel").querySelectorAll(".acc-chip button").forEach((b) => (b.onclick = () => { accSel.delete(b.parentElement.dataset.id); renderAccSel(); }));
  }
  function closeAccRes() { $("pAccRes").classList.add("hidden"); $("pAccRes").innerHTML = ""; }
  async function searchAccounts() {
    const q = $("pAccQ").value.trim(), seq = ++accSeq;
    if (q.length < 2) { closeAccRes(); return; }
    let r;
    try { r = await call("users", { q, page: 0, page_size: 8 }); } catch (e) { if (e.code !== "auth") toast(errText(e), true); return; }
    if (seq !== accSeq) return;
    const items = r.items || [];
    $("pAccRes").innerHTML = items.length ? items.map((u) => {
      const name = fullName(u), label = name ? `${name} (${u.email})` : u.email, on = accSel.has(u.id);
      return `<li role="option" aria-selected="${on}"><button type="button" data-id="${esc(u.id)}" data-l="${esc(label)}"${on ? ' class="on"' : ""}>
        ${name ? `<b>${esc(name)}</b> <span class="sub">${esc(u.email)}</span>` : `<b>${esc(u.email)}</b>`}${on ? '<span class="chk">gekozen</span>' : ""}</button></li>`;
    }).join("") : '<li class="empty">Geen accounts gevonden.</li>';
    $("pAccRes").classList.remove("hidden");
    $("pAccRes").querySelectorAll("button[data-id]").forEach((b) => (b.onclick = () => {
      const id = b.dataset.id;
      if (accSel.has(id)) accSel.delete(id);
      else if (accSel.size >= 500) { toast(ERR.too_many_accounts, true); return; }
      else accSel.set(id, b.dataset.l);
      renderAccSel(); searchAccounts(); $("pAccQ").focus();
    }));
  }
  $("pAccQ").addEventListener("input", () => { clearTimeout(accTimer); accTimer = setTimeout(searchAccounts, 250); });
  $("pAccQ").addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAccRes();
    if (e.key === "Enter") { e.preventDefault(); $("pAccRes").querySelector("button[data-id]")?.click(); }
    if (e.key === "ArrowDown") { e.preventDefault(); $("pAccRes").querySelector("button[data-id]")?.focus(); }
  });
  $("pAccRes").addEventListener("keydown", (e) => {
    const all = [...$("pAccRes").querySelectorAll("button[data-id]")], i = all.indexOf(document.activeElement);
    if (e.key === "ArrowDown" && i >= 0) { e.preventDefault(); all[Math.min(i + 1, all.length - 1)].focus(); }
    if (e.key === "ArrowUp" && i >= 0) { e.preventDefault(); (i === 0 ? $("pAccQ") : all[i - 1]).focus(); }
    if (e.key === "Escape") { closeAccRes(); $("pAccQ").focus(); }
  });
  document.addEventListener("click", (e) => { if (!e.target.closest?.(".acc-search")) closeAccRes(); });
  renderAccSel();

  function readTarget() {
    const m = targetMode();
    if (m === "accounts") return accSel.size ? { accounts: [...accSel.keys()] } : null;
    if (m === "platforms") {
      const p = [...$("pPlatforms").querySelectorAll("input:checked:not(:disabled)")].flatMap((c) => c.value.split(","));
      return p.length ? { platforms: p } : null;
    }
    return { all: true };
  }
  const pfList = (ps) => [...new Set((ps || []).map((p) => ({ ios: "iPhone/iPad", ipados: "iPhone/iPad" })[p] || PUSH_PF[p] || p))].join(", ");
  function targetText(t, item) {
    if (item?.kind === "release") return item.platform_group ? `${PUSH_GROUP[item.platform_group] || item.platform_group}, wie nog niet bijgewerkt is` : "Wie nog niet bijgewerkt is";
    if (!t || t.type === "unknown") return item?.kind === "reminder" ? "Eén account" : "—";
    if (t.type === "all" || t.all) return "Alle gebruikers";
    if (t.type === "accounts") return `${nf.format(t.count ?? 0)} ${t.count === 1 ? "account" : "accounts"}`;
    return pfList(t.platforms);
  }

  $("composeForm").onsubmit = async (e) => {
    e.preventDefault();
    if (sending) return;
    const err = (m) => { $("composeErr").textContent = m; };
    const data = { title_nl: $("tNl").value.trim(), body_nl: $("bNl").value.trim(), title_en: $("tEn").value.trim(), body_en: $("bEn").value.trim(), url: $("pUrl").value.trim() };
    err("");
    if (!data.title_nl || !data.body_nl) return err(ERR.text_missing);
    if (!!data.title_en !== !!data.body_en) return err(ERR.en_incomplete);
    if (data.url && !/^https:\/\/[^\s/]+\.[^\s/]+/i.test(data.url)) return err(ERR.bad_link);
    const target = readTarget();
    if (!target) return err(targetMode() === "accounts" ? ERR.no_accounts : ERR.no_platforms);
    sending = true; $("sendBtn").disabled = true;
    try {
      // bevestiging met het aantal apparaten (push_count)
      let c = null;
      try { c = await call("push_count", { target }); } catch (x) { if (x.code === "auth") return; if (x.body?.error && x.code !== "server_error") return err(errText(x)); }
      const n = c?.devices;
      const parts = c?.by_platform ? Object.entries(c.by_platform).filter(([, v]) => v > 0).map(([k, v]) => `${PUSH_PF[k] || k} ${nf.format(v)}`).join(", ") : "";
      const acc = "accounts" in target && c?.accounts != null
        ? `\n\n${nf.format(c.accounts)} van de ${nf.format(target.accounts.length)} gekozen accounts ${c.accounts === 1 ? "heeft" : "hebben"} pushmeldingen aan.` : "";
      if (n === 0) return err("Geen apparaten met pushmeldingen in deze doelgroep; er is niets verstuurd.");
      const q = n == null ? "Het aantal apparaten is nog niet bekend. Toch versturen?"
        : `Pushmelding versturen naar ${nf.format(n)} ${n === 1 ? "apparaat" : "apparaten"}${parts ? ` (${parts})` : ""}?${acc}`;
      if (!confirm(q)) return;
      const r = await call("push_send", { title_nl: data.title_nl, body_nl: data.body_nl, ...(data.title_en ? { title_en: data.title_en, body_en: data.body_en } : {}), ...(data.url ? { url: data.url } : {}), target });
      ["tNl", "bNl", "tEn", "bEn", "pUrl"].forEach((id) => ($(id).value = ""));
      preview();
      phPage = 0; loadPushHistory();
      await followPush(r);
      loadPushHistory();
    } catch (x) { if (x.code !== "auth") err(errText(x)); }
    finally { sending = false; $("sendBtn").disabled = false; }
  };

  function countsText(r) {
    const bits = [`${nf.format(r.sent || 0)} verstuurd`];
    if (r.failed) bits.push(`${nf.format(r.failed)} mislukt`);
    if (r.invalid) bits.push(`${nf.format(r.invalid)} ongeldig`);
    if (r.queued) bits.push(`${nf.format(r.queued)} in wachtrij`);
    return bits.join(", ");
  }
  // voortgang van een verstuurd bericht: push_progress herhalen tot done (versturen gaat in batches)
  async function followPush(first) {
    const box = $("progress"), bar = box.querySelector(".bar span"), txt = box.querySelector(".sub");
    box.classList.remove("hidden");
    const show = (r) => {
      const tot = r.devices || 0, done = (r.sent || 0) + (r.failed || 0) + (r.invalid || 0);
      bar.style.width = `${tot ? Math.min(100, (done / tot) * 100) : r.done ? 100 : 0}%`;
      txt.textContent = `Push: ${countsText(r)} van ${nf.format(tot)} ${tot === 1 ? "apparaat" : "apparaten"}${r.done ? " · klaar" : "…"}`
        + ((r.notes || []).length ? ` · ${(r.notes || []).map((n) => PUSH_NOTE[n] || n).join(", ")}` : "");
    };
    let r = first;
    show(r);
    for (let i = 0; i < 600 && !r.done && r.message_id; i++) {
      await new Promise((ok) => setTimeout(ok, 1500));
      try { r = await call("push_progress", { message_id: r.message_id }); }
      catch (e) { if (e.code !== "auth") toast(`${errText(e)} De voortgang staat ook in de geschiedenis.`, true); return; }
      show(r);
    }
    toast(`Pushmelding: ${countsText(r)}.`, !!r.failed);
  }

  function loadPushTab() { loadPushHistory(); loadPushSubs(); preview(); }
  // pushabonnees bovenaan de tab (push_subscribers): accounts, apparaten per platform, nieuw in 7 dagen
  async function loadPushSubs() {
    let r;
    try { r = await call("push_subscribers"); }
    catch (e) { if (e.code !== "auth") $("pushSubs").innerHTML = `<p class="empty">${esc(errText(e))}</p>`; return; }
    if (r.devices == null) { $("pushSubs").innerHTML = '<p class="empty">Nog niet te tellen.</p>'; return; }
    dd.subs = r; dd.subsErr = null;
    const by = r.by_platform || {}, nw = r.new_7d || {};
    const cell = (l, v, h, cls = "") => `<div class="ps-k${cls}"><span class="l">${esc(l)}</span><b>${nf.format(v || 0)}</b>${h ? `<span class="h">${esc(h)}</span>` : ""}</div>`;
    $("pushSubs").innerHTML = cell("Accounts", r.accounts, `+${nf.format(nw.accounts || 0)} in 7 dagen`, " main")
      + cell("Apparaten", r.devices, `+${nf.format(nw.devices || 0)} in 7 dagen`, " main")
      + PUSH_PFS.map((k) => cell(PUSH_PF_NAME[k], by[k])).join("");
  }
  $("pushRefresh").onclick = loadPushTab;
  $("phPrev").onclick = () => { if (phPage > 0) { phPage--; loadPushHistory(); } };
  $("phNext").onclick = () => { phPage++; loadPushHistory(); };
  async function loadPushHistory() {
    let r;
    try { r = await call("push_history", { page: phPage }); }
    catch (e) {
      if (e.code === "auth") return;
      $("pushList").innerHTML = `<p class="empty">${esc(errText(e))}</p>`;
      $("phPrev").disabled = $("phNext").disabled = true; $("phPage").textContent = "";
      return;
    }
    const items = r.items || [];
    $("pushList").innerHTML = items.map((m) => {
      const [kl, kc] = PUSH_KIND[m.kind] || PUSH_KIND.admin;
      const title = pushTitle(m);
      const n = (k, label, cls) => `<span class="ph-n ${cls}"><b>${nf.format(m[k] || 0)}</b> ${label}</span>`;
      return `<div class="ph"><div class="ph-main">
          <div class="ph-top"><span class="kind ${kc}">${kl}</span><span class="tt">${esc(title)}</span></div>
          ${m.body && m.kind !== "release" ? `<div class="bd">${esc(m.body)}</div>` : ""}
          <div class="meta"><span>${esc(fmtDateTime(m.created_at))}</span><span>· ${esc(targetText(m.target, m))}</span>
            ${m.url ? `<span>· link naar ${esc((() => { try { return new URL(m.url).hostname; } catch { return "?"; } })())}</span>` : ""}
            ${(m.notes || []).map((x) => `<span class="chip warn">${esc(PUSH_NOTE[x] || x)}</span>`).join("")}</div></div>
        <div class="ph-nums" aria-label="Aantallen">${n("queued", "in wachtrij", "q")}${n("sent", "verstuurd", "s")}${n("failed", "mislukt", "f")}${n("invalid", "ongeldig", "i")}
          <span class="ph-tot">${nf.format(m.devices || 0)} ${m.devices === 1 ? "apparaat" : "apparaten"}${m.done ? "" : " · bezig"}</span></div></div>`;
    }).join("") || `<p class="empty">${phPage ? "Geen oudere meldingen." : "Nog geen pushmeldingen."}</p>`;
    $("phPrev").disabled = phPage === 0; $("phNext").disabled = !r.has_more;
    $("phPage").textContent = `Pagina ${phPage + 1}`;
  }


  // ---- nieuwsbrief (tab "newsletter"; functie admin -> newsletter in iptv-ios-appletv) ----
  // Acties newsletter_status, newsletter_set_enabled, newsletter_preview (één adres, nooit gelogd) en newsletter_render;
  // blok Welkomstmail: welcome_preview en welcome_render (zelfde veilige weergave), aantallen uit newsletter_status.welcome.
  // De voorbeeldweergave staat in een Shadow DOM: de HTML wordt eerst inert geparsed (DOMParser), scripts en
  // event-attributen gaan eruit en style-attributen worden via element.style gezet (de strikte CSP blokkeert style=; een
  // blob-tabblad of srcdoc-iframe erft die CSP, waardoor de opmaak van de mail daar zou wegvallen).
  Object.assign(ERR, {
    newsletter_not_configured: "De nieuwsbrief is nog niet ingesteld (NEWSLETTER_ADMIN_SECRET; workflow Backend in iptv-ios-appletv draaien).",
    newsletter_not_deployed: "De functie newsletter staat nog niet online (workflow Backend in iptv-ios-appletv draaien).",
    newsletter_forbidden: "De functie newsletter weigerde de aanvraag (NEWSLETTER_ADMIN_SECRET klopt niet).",
    newsletter_unreachable: "De functie newsletter is niet bereikbaar. Probeer het later opnieuw.",
    bad_email: "Vul een geldig e-mailadres in.", bad_lang: "Kies Nederlands of Engels.", bad_enabled: "Ongeldige keuze (aan of uit).",
    tmdb_unavailable: "De films en series konden niet worden opgehaald (TMDB). Probeer het later opnieuw.",
    email_opted_out: "Deze klant heeft alle mail van Bingr uitgezet; alleen de klant kan dat weer aanzetten.",
    newsletter_prefs_unavailable: "De nieuwsbriefstand per account is nog niet beschikbaar (databaseschema bijwerken: workflow Backend in iptv-ios-appletv).",
  });
  let nlState = null, nlBusy = false, nlSendLang = "nl", nlViewLang = "nl", nlRender = {};
  function nlSeg(id, set) {
    document.querySelectorAll(`#${id} button`).forEach((b) => (b.onclick = () => {
      document.querySelectorAll(`#${id} button`).forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
      set(b.dataset.lang);
    }));
  }
  nlSeg("nlSendLang", (l) => { nlSendLang = l; });
  nlSeg("nlViewLang", (l) => { nlViewLang = l; if (!$("nlView").classList.contains("hidden")) showNlPreview(); });
  // welkomstmail (acties welcome_preview / welcome_render; aantallen uit newsletter_status.welcome)
  let wlSendLang = "nl", wlViewLang = "nl";
  const wlRender = {};
  nlSeg("wlSendLang", (l) => { wlSendLang = l; });
  nlSeg("wlViewLang", (l) => { wlViewLang = l; if (!$("wlView").classList.contains("hidden")) showWlPreview(); });

  function renderNl() {
    const s = nlState, sw = $("nlEnabled");
    if (!s) return;
    sw.checked = !!s.enabled; sw.disabled = nlBusy;
    $("nlEnabledText").innerHTML = s.enabled ? "<b>Aan</b> · de nieuwsbrief wordt verstuurd" : "<b>Uit</b> · er wordt niets verstuurd";
    const r = s.recipients || {};
    const cell = (l, v, h, cls = "") => `<div class="ps-k${cls}"><span class="l">${esc(l)}</span><b>${esc(v)}</b>${h ? `<span class="h">${esc(h)}</span>` : ""}</div>`;
    $("nlFacts").innerHTML = cell("Volgende verzending", s.enabled && s.next?.at ? fmtNl(s.next.at) : s.next?.at ? "uit" : "—",
      s.next?.at ? (s.enabled ? "Nederlandse tijd" : `anders ${fmtNl(s.next.at)}`) : "", " nl-next")
      + cell("Ontvangers", nf.format(r.total || 0), "leden met mail aan", " main")
      + cell("Nederlands", nf.format(r.nl || 0), "NL") + cell("Engels", nf.format(r.en || 0), "EN");
    const eds = s.editions || [];
    $("nlEditions").innerHTML = eds.map((e) => {
      const n = (v, label, cls) => `<span class="ph-n ${cls}"><b>${nf.format(v || 0)}</b> ${label}</span>`;
      return `<div class="ph"><div class="ph-main"><div class="ph-top"><span class="kind rem">Editie</span><span class="tt">${esc(e.key || "—")}</span></div>
          <div class="meta"><span>${esc(fmtDateTime(e.created_at))}</span>${e.done ? "" : '<span class="chip warn">bezig</span>'}</div></div>
        <div class="ph-nums nl-nums" aria-label="Aantallen">${n(e.recipients, "ontvangers", "")}${n(e.sent, "verstuurd", "s")}${n(e.failed, "mislukt", "f")}</div></div>`;
    }).join("") || '<p class="empty">Nog geen edities verstuurd.</p>';
    const w = s.welcome;
    $("wlFacts").innerHTML = w
      ? cell("Verstuurd", nf.format(w.sent_7d || 0), "laatste 7 dagen", " main") + cell("Wachtend", nf.format(w.pending || 0), "gaat binnen 5 minuten")
      : '<p class="empty">Nog geen gegevens (workflow Backend in iptv-ios-appletv draaien).</p>';
  }
  function nlNotice(msg) { $("nlNotice").textContent = msg || ""; $("nlNotice").classList.toggle("hidden", !msg); }
  async function loadNewsletter() {
    let r;
    try { r = await call("newsletter_status"); }
    catch (e) {
      if (e.code === "auth") return;
      nlState = null; nlNotice(errText(e));
      $("nlEnabled").disabled = true; $("nlEnabledText").textContent = "Niet beschikbaar";
      $("nlFacts").innerHTML = ""; $("nlEditions").innerHTML = '<p class="empty">Geen gegevens.</p>';
      $("wlFacts").innerHTML = '<p class="empty">Geen gegevens.</p>';
      return;
    }
    nlNotice(""); nlState = r; dd.nl = r; dd.nlErr = null; renderNl();
  }
  $("nlRefresh").onclick = loadNewsletter;
  $("nlEnabled").onchange = async () => {
    const sw = $("nlEnabled"), on = sw.checked;
    if (!nlState || nlBusy) { sw.checked = !on; return; }
    if (on) {
      const r = nlState.recipients || {}, total = r.total || 0;
      const when = nlState.next?.at ? `\n\nVolgende verzending: ${fmtNl(nlState.next.at)}.` : "";
      if (!confirm(`De nieuwsbrief aanzetten? Hij gaat naar ${nf.format(total)} ${total === 1 ? "lid" : "leden"} (${nf.format(r.nl || 0)} NL, ${nf.format(r.en || 0)} EN).${when}`)) { sw.checked = false; return; }
    }
    nlBusy = true; sw.disabled = true;
    try {
      const r = await call("newsletter_set_enabled", { enabled: on });
      nlState.enabled = !!r.enabled;
      toast(r.enabled ? "Nieuwsbrief staat aan." : "Nieuwsbrief staat uit.");
      loadNewsletter();
    } catch (e) { sw.checked = !on; if (e.code !== "auth") toast(errText(e), true); }
    finally { nlBusy = false; renderNl(); }
  };
  $("nlPreviewForm").onsubmit = async (e) => {
    e.preventDefault();
    const to = $("nlTo").value.trim(), err = (m) => { $("nlSendErr").textContent = m; };
    err("");
    if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[A-Za-z]{2,}$/.test(to) || to.length > 254) return err(ERR.bad_email);
    $("nlSend").disabled = true;
    try {
      await call("newsletter_preview", { to, lang: nlSendLang });
      toast(`Voorbeeld (${nlSendLang.toUpperCase()}) verstuurd.`);
    } catch (x) { if (x.code !== "auth") err(errText(x)); }
    finally { $("nlSend").disabled = false; }
  };

  async function nlHtml(lang) {
    if (nlRender[lang] && Date.now() - nlRender[lang].at < 120000) return nlRender[lang];
    const r = await call("newsletter_render", { lang });
    nlRender[lang] = { subject: r.subject || "", html: r.html || "", at: Date.now() };
    return nlRender[lang];
  }
  const NL_DROP = "script,iframe,frame,frameset,object,embed,applet,form,input,button,textarea,select,base,meta,link,noscript,template,svg script";
  // mail-HTML veilig in de Shadow DOM zetten: inert parsen, gevaarlijke elementen en attributen weg, style via element.style
  function mountMail(host, html) {
    // eerst als tekst: <style>-blokken eruit en style= hernoemen, zodat ook het inerte parsen geen CSP-meldingen geeft
    const cssParts = [];
    const src = String(html).replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_, c) => { cssParts.push(c); return ""; })
      .replace(/(<[a-z][^>]*?\s)style(\s*=)/gi, "$1data-nl-style$2");
    const doc = new DOMParser().parseFromString(src, "text/html");
    const css = cssParts.concat([...doc.querySelectorAll("style")].map((s) => s.textContent || "")).join("\n");
    doc.querySelectorAll(`style,${NL_DROP}`).forEach((n) => n.remove());
    doc.querySelectorAll("*").forEach((el) => {
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
        if (n.startsWith("on") || n === "srcset" || n === "formaction") el.removeAttribute(a.name);
        else if ((n === "href" || n === "src" || n === "action" || n === "background") && !/^(https:|mailto:|#)/.test(v)) el.removeAttribute(a.name);
        else if (n === "style") { el.setAttribute("data-nl-style", a.value); el.removeAttribute("style"); }
      }
      if (el.tagName === "A") { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); }
    });
    const root = host.shadowRoot || host.attachShadow({ mode: "open" });
    root.replaceChildren();
    try {
      const base = new CSSStyleSheet();
      base.replaceSync(":host{display:block;background:#fff;color:#111}.nl-body{min-height:200px;overflow:auto}img{max-width:100%;height:auto}");
      const sheets = [base];
      if (css.trim()) { const s = new CSSStyleSheet(); s.replaceSync(css); sheets.push(s); }
      root.adoptedStyleSheets = sheets;
    } catch { /* geen constructable stylesheets: alleen de inline stijlen */ }
    const wrap = document.createElement("div");
    wrap.className = "nl-body";
    const body = doc.body;
    for (const a of ["bgcolor", "data-nl-style"]) if (body.hasAttribute(a)) wrap.setAttribute(a, body.getAttribute(a));
    wrap.append(...[...body.childNodes].map((n) => document.importNode(n, true)));
    root.append(wrap);
    root.querySelectorAll("[data-nl-style]").forEach((el) => { el.style.cssText = el.getAttribute("data-nl-style"); el.removeAttribute("data-nl-style"); });
    if (wrap.hasAttribute("bgcolor")) wrap.style.backgroundColor = wrap.getAttribute("bgcolor");
  }
  async function showNlPreview() {
    const btn = $("nlShow"), lang = nlViewLang;
    btn.disabled = true;
    try {
      const r = await nlHtml(lang);
      if (lang !== nlViewLang) return;
      $("nlSubject").innerHTML = `<span class="sub">Onderwerp</span> <b>${esc(r.subject || "—")}</b>`;
      $("nlSubject").classList.remove("hidden");
      $("nlView").classList.remove("hidden");
      mountMail($("nlView"), r.html);
    } catch (e) { if (e.code !== "auth") toast(errText(e), true); }
    finally { btn.disabled = false; }
  }
  $("nlShow").onclick = showNlPreview;

  $("wlPreviewForm").onsubmit = async (e) => {
    e.preventDefault();
    const to = $("wlTo").value.trim(), err = (m) => { $("wlSendErr").textContent = m; };
    err("");
    if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[A-Za-z]{2,}$/.test(to) || to.length > 254) return err(ERR.bad_email);
    $("wlSend").disabled = true;
    try {
      await call("welcome_preview", { to, lang: wlSendLang });
      toast(`Voorbeeld van de welkomstmail (${wlSendLang.toUpperCase()}) verstuurd.`);
    } catch (x) { if (x.code !== "auth") err(errText(x)); }
    finally { $("wlSend").disabled = false; }
  };
  async function showWlPreview() {
    const btn = $("wlShow"), lang = wlViewLang;
    btn.disabled = true;
    try {
      if (!wlRender[lang] || Date.now() - wlRender[lang].at > 120000) {
        const r = await call("welcome_render", { lang });
        wlRender[lang] = { subject: r.subject || "", html: r.html || "", at: Date.now() };
      }
      if (lang !== wlViewLang) return;
      const r = wlRender[lang];
      $("wlSubject").innerHTML = `<span class="sub">Onderwerp</span> <b>${esc(r.subject || "—")}</b>`;
      $("wlSubject").classList.remove("hidden");
      $("wlView").classList.remove("hidden");
      mountMail($("wlView"), r.html);
    } catch (e) { if (e.code !== "auth") toast(errText(e), true); }
    finally { btn.disabled = false; }
  }
  $("wlShow").onclick = showWlPreview;
  $("nlDownload").onclick = async () => {
    const btn = $("nlDownload"), lang = nlViewLang;
    btn.disabled = true;
    try {
      const r = await nlHtml(lang);
      const url = URL.createObjectURL(new Blob([r.html], { type: "text/html;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url; a.download = `bingr-nieuwsbrief-${lang}.html`; a.rel = "noopener";
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { if (e.code !== "auth") toast(errText(e), true); }
    finally { btn.disabled = false; }
  };

  // ---- status ----
  const ST = { up: "Werkt", degraded: "Verminderd", down: "Storing" };
  const GRP = { server: "Server", website: "Website", apps: "Apps" };
  const KIND = { http: "Website (URL)", auth: "Supabase Auth", db: "Database", fn: "Edge Function", storage: "Opslag", smtp: "SMTP",
    tls: "TLS-certificaat", gh_asset: "GitHub-release", build: "Build in de opslag", gh_workflow: "GitHub-build", devices: "Informatie" };
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
