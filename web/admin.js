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
  };
  // ---- abonnementen (zelfde standaarden als de server, docs/ACCOUNT.md in iptv-ios-appletv) ----
  const PLAN_DEFAULTS = { free: { streams: 2, devices: 8 }, lifetime: { streams: 6, devices: 15 } };
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
    if (!loaded[name]) { loaded[name] = true; ({ overview: loadStats, users: loadUsers, support: loadTickets, messages: loadAnnouncements, status: loadStatus, settings: loadSettings })[name](); }
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
    showTab(["overview", "users", "support", "messages", "status", "settings"].includes(tab) ? tab : "overview");
    if (deep && deep[1]) openTicket(Number(deep[1]));
    loadSupportCounts();
    clearInterval(supTimer); supTimer = setInterval(() => { if (token() && !document.hidden) loadSupportCounts(); }, 120000);
  }
  let supTimer;
  window.addEventListener("hashchange", () => { const m = /^#support\/(\d+)$/.exec(location.hash); if (m && token()) { showTab("support"); openTicket(Number(m[1])); } });

  // ---- overzicht ----
  $("refresh").onclick = () => loadStats();
  async function loadStats() {
    let s;
    try { s = await call("stats"); } catch (e) { if (e.code !== "auth") toast(errText(e), true); return; }
    smtpOk = !!s.smtp; applySmtp();
    const k = [
      ["Gebruikers", s.total_users, `${nf.format(s.confirmed_users ?? 0)} bevestigd`],
      ["Nieuw (7 dagen)", s.new_users_7d, ""],
      ["Actief vandaag", s.active_today, "accounts"],
      ["Actief (30 dagen)", s.active_30d, "accounts"],
      ["Apparaten", s.devices_total, "gekoppeld"],
      ["Kijkt nu", s.watching_now, "streams", "live"],
    ];
    const planKpis = s.plan_lifetime != null
      ? `<button type="button" class="kpi plan" data-plan="free" title="Gratis accounts bekijken"><div class="l">Gratis</div><div class="v">${nf.format(s.plan_free ?? 0)}</div><div class="h">accounts</div></button>` +
        `<button type="button" class="kpi plan life" data-plan="lifetime" title="Lifetime-accounts bekijken"><div class="l">Lifetime</div><div class="v">${nf.format(s.plan_lifetime ?? 0)}</div><div class="h">${s.plan_custom ? `${nf.format(s.plan_custom)} met eigen limieten` : "accounts"}</div></button>`
      : "";
    const blockedKpi = s.blocked_users != null
      ? `<button type="button" id="kpiBlocked" class="kpi ${s.blocked_users ? "blocked" : ""}" title="Geblokkeerde accounts bekijken"><div class="l">Geblokkeerd</div><div class="v">${nf.format(s.blocked_users)}</div><div class="h">accounts</div></button>`
      : "";
    $("kpis").innerHTML = k.map(([l, v, h, cls]) =>
      `<div class="kpi ${cls || ""}"><div class="l">${esc(l)}</div><div class="v">${nf.format(v ?? 0)}</div><div class="h">${esc(h)}</div></div>`).join("") +
      `<button type="button" id="kpiSup" class="kpi sup" title="Naar de tab Support"><div class="l">Open tickets</div><div class="v">${supCounts ? nf.format(supCounts.active ?? 0) : "—"}</div><div class="h">${supCountsText()}</div></button>` + blockedKpi + planKpis;
    $("kpis").querySelectorAll("button[data-plan]").forEach((b) => (b.onclick = () => { userFilter = b.dataset.plan; page = 0; const was = loaded.users; showTab("users"); if (was) loadUsers(); }));
    $("kpiSup").onclick = () => showTab("support");
    if ($("kpiBlocked")) $("kpiBlocked").onclick = () => { userFilter = "blocked"; page = 0; const was = loaded.users; showTab("users"); if (was) loadUsers(); };
    const days = s.days || [];
    const audit = s.signins_source === "audit";
    lastCharts = () => {
      barChart($("chartNew"), days.map((d) => ({ x: d.day, y: d.new_users })), "nieuwe gebruikers");
      barChart($("chartSign"), days.map((d) => ({ x: d.day, y: d.signins })), audit ? "inlogs" : "actieve accounts");
    };
    $("signinTitle").textContent = audit ? "Inloggen per dag" : "Actieve accounts per dag";
    $("signinSub").textContent = audit ? "Laatste 30 dagen, uit het inloglogboek" : "Laatste 30 dagen, accounts met app-activiteit (inloglogboek leeg)";
    lastCharts();
    hbars($("platforms"), (s.platforms || []).map((p) => ({ label: esc(pname(p.platform)), n: p.devices })));
    hbars($("versions"), (s.versions || []).map((v) => ({ label: `${esc(v.app_version === "?" ? "onbekend" : v.app_version)} <small>${esc(pname(v.platform))}</small>`, n: v.devices })));
  }

  let lastCharts = null, resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => lastCharts && !$("tab-overview").classList.contains("hidden") && lastCharts(), 150); });
  // Staafdiagram (één reeks) met hover-tooltip; inline SVG.
  function barChart(el, data, unit) {
    if (!data.length) { el.innerHTML = '<p class="empty">Nog geen gegevens.</p>'; return; }
    const W = Math.max(280, Math.round(el.clientWidth || 560)), H = 190, L = 28, R = 4, T = 8, B = 22;
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
      if ((data.length - 1 - i) % 7 === 0) ticks += `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${shortDay(d.x)}</text>`;
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
  function hbars(el, rows) {
    if (!rows.length) { el.innerHTML = '<p class="empty">Nog geen gegevens.</p>'; return; }
    const max = Math.max(...rows.map((r) => r.n), 1);
    el.innerHTML = rows.slice(0, 14).map((r) =>
      `<div class="hbar"><span class="n">${r.label}</span><span class="t"><span data-w="${Math.max(2, (r.n / max) * 100).toFixed(1)}"></span></span><span class="c">${nf.format(r.n)}</span></div>`).join("") +
      (rows.length > 14 ? `<p class="sub">+ ${rows.length - 14} meer</p>` : "");
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
      <p class="sub">${life ? `Lifetime${src ? ", " + esc(src) : ""}${p.updated_at ? " · " + esc(fmtDate(p.updated_at)) : ""}` : "Gratis: 2 tegelijk kijken, 8 apparaten, 1 server, zonder statistieken, nu aan het kijken, Trakt en thema's."}</p>
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
    if ($("kpiSup")) { $("kpiSup").querySelector(".v").textContent = nf.format(c.active ?? 0); $("kpiSup").querySelector(".h").textContent = supCountsText(); $("kpiSup").classList.toggle("alert", !!u); }
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
