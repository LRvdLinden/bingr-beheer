// Bingr: beheer (https://beheer.bingr.online, privé-repo LRvdLinden/bingr-beheer). Los van device-auth; nooit in de changelog.
// POST /functions/v1/admin met JSON {action, token?, ...}; header `apikey`.
// Inloggegevens alleen als function-secrets BINGR_ADMIN_USER / BINGR_ADMIN_PASSWORD (uit de GitHub-secrets).
//   login               {user, password}  -> {token, expires_at}   (5 fouten per IP = 15 min geblokkeerd: 429 {error:"locked", retry_after})
//   stats               {token}           -> {total_users, …, days:[…], platforms:[…], versions:[…], smtp}
//   users               {token, q?, page?, page_size?, filter?: "blocked"|"free"|"lifetime"|"custom"}
//                       -> {total, blocked_total, lifetime_total, free_total, page, page_size, items:[…]}
//                       (e-mail gemaskeerd; items[].blocked = {until, created_at} bij een actieve blokkade;
//                       items[].plan = {plan, max_streams?, max_devices?, source?})
//   user_detail         {token, id}       -> {…, devices:[…], banned_until, block (actief of null), blocks:[…] (laatste 20)}
//   user_block          {token, id, reason, until? (ISO; leeg/"onbepaald" = onbepaalde tijd), notify? (standaard true)}
//                       -> {ok, until, streams_stopped, email_sent, email_error?}  (ban op het auth-account, record in
//                       account_blocks, lopende streams gestopt, mail vanaf support@ met reden en einddatum). Sessies blijven
//                       bestaan: vernieuwen geeft dan user_banned, zodat de apps de melding "geblokkeerd" tonen (ACCOUNT.md).
//   user_unblock        {token, id, notify? (standaard true)} -> {ok, email_sent, email_error?}
//   user_delete         {token, id, confirm (volledig of gemaskeerd e-mailadres), notify? (standaard true), delete_tickets?,
//                       reason? (intern, alleen in het logboek)} -> {ok, email_sent, tickets_deleted}
//                       (alle accountgegevens via on delete cascade, profielfoto's, daarna de bevestigingsmail vanaf support@)
//   send_reset          {token, user_id}  -> {ok}    (standaard reset-mail van Supabase; beheer ziet of zet nooit wachtwoorden)
//   announce            {token, title_nl, body_nl, title_en?, body_en?, expires_at?, email} -> {ok, id, email_total}
//   announce_send       {token, id}       -> {email_total, email_sent, email_failed, done}  (volgende batch; herhalen tot done)
//   announcements_list  {token}           -> {items:[…]}
//   announcement_delete {token, id}       -> {ok}
//   status              {token, op: overview|checks|monitor_save|monitor_delete|run|notice_save|notice_update|notice_delete|
//                        subscribers|mail_run, …} -> antwoord van de functie `status` (meldingen: storingen en gepland onderhoud)
//   support_counts      {token}           -> {new, open, pending, resolved, closed, active, unread, total, last_7d, smtp}
//   support_list        {token, status?: active|all|new|open|pending|resolved|closed, q?, page?, page_size?} -> {total, items:[…], counts}
//   support_get         {token, number}   -> {ticket, messages (ook interne notities), account}
//   support_reply       {token, number, message, status?} -> {ok, status, email_sent}  (mail aan de klant vanaf support@bingr.online)
//   support_status      {token, number, status?, priority?, notify?} -> {ok, status, email_sent}  (opgelost/gesloten: mail aan de klant)
//   support_note        {token, number, message} -> {ok}  (interne notitie, de klant ziet hem nooit)
//   support_inbox       {token}           -> {configured, agents, state, log}  (inbox-import: laatste ronde, fout, logboek)
//   support_poll        {token}           -> {ok, fetched, imported, …} | {skipped} | {busy}  (nu mails ophalen)
//                       De support_*-acties gaan door naar de functie `support` (LRvdLinden/iptv-ios-appletv) met het geheim
//                       SUPPORT_ADMIN_SECRET (zet de Backend-workflow daar klaar). Supporttickets komen nooit in de changelog.
//   plan_get            {token, id}       -> {plan, max_streams, max_devices, source, note, granted_by, updated_at, defaults, effective}
//   plan_set            {token, id, plan: "free"|"lifetime", max_streams: int|null, max_devices: int|null, note?}
//                       -> {ok, …zoals plan_get}  (abonnement van een account; null = standaard van het abonnement;
//                       granted_by "beheer" (niet de inlognaam: de klant kan zijn eigen rij lezen), source 'admin';
//                       Gratis zonder eigen limieten en notitie = rij weg)
//   app_settings_get    {token}           -> {upgrade_link:{apple, android, androidtv, tizen, web}}
//   app_settings_set    {token, upgrade_link:{apple, android, androidtv, tizen, web}} -> {ok, upgrade_link}
//                       Abonnementen: tabellen account_plans en app_settings (schema in iptv-ios-appletv, docs/ACCOUNT.md).
//   unsubscribe         {t}               -> {ok}    (openbaar; t = ondertekend token uit de e-mail)
//   POST ?unsubscribe=t (List-Unsubscribe=One-Click, RFC 8058) -> 200 "unsubscribed"; GET ?unsubscribe=t -> 303 naar bingr.online/unsubscribe/
import { createClient } from "jsr:@supabase/supabase-js@2";
import { smtpConfigured, smtpFrom, transport } from "../_shared/mail.ts";
import { announcementMail, blockMail, deletedMail, type Mail, unblockMail } from "./mails.ts";
import { accountLang, banDuration, cleanReason, confirmMatches, parseUntil } from "./blocks.ts";

const SITE = Deno.env.get("BINGR_SITE") ?? "https://bingr.online";
const env = (k: string) => Deno.env.get(k) ?? "";
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});
const TOKEN_TTL_MS = 12 * 3600 * 1000;

// ---- abonnementen (zelfde standaarden als supabase/functions/_shared/plans.ts in iptv-ios-appletv) ----
const PLAN_DEFAULTS = { free: { streams: 2, devices: 8, servers: 1 }, lifetime: { streams: 6, devices: 15, servers: null } } as const;
const LINK_KEYS = ["apple", "android", "androidtv", "tizen", "web"] as const;
const DEFAULT_LINK: Record<string, boolean> = { apple: false, android: true, androidtv: true, tizen: true, web: true };
// eigen limiet: null/leeg = standaard; anders een geheel getal binnen [1, cap]; ongeldig = undefined (fout)
function limitInput(v: unknown, cap: number): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isInteger(n) && n >= 1 && n <= cap ? n : undefined;
}
function planView(row: Record<string, unknown> | null) {
  const plan = row?.plan === "lifetime" ? "lifetime" : "free";
  const d = PLAN_DEFAULTS[plan];
  const ms = (row?.max_streams as number | null) ?? null, md = (row?.max_devices as number | null) ?? null;
  return {
    plan, max_streams: ms, max_devices: md, source: row?.source ?? null, note: row?.note ?? null, granted_by: row?.granted_by ?? null,
    created_at: row?.created_at ?? null, updated_at: row?.updated_at ?? null,
    defaults: PLAN_DEFAULTS, effective: { streams: ms ?? d.streams, devices: md ?? d.devices, servers: d.servers },
  };
}
const linkView = (v: unknown) => {
  const o = v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
  return Object.fromEntries(LINK_KEYS.map((k) => [k, typeof o[k] === "boolean" ? o[k] : DEFAULT_LINK[k]]));
};
const BATCH = 25;

// Het dashboard staat op https://beheer.bingr.online (http://localhost om te testen). De site bingr.online mag alleen
// `unsubscribe` aanroepen (afmeldpagina bingr.online/unsubscribe/); al het andere vanaf daar wordt geweigerd.
const BEHEER_ORIGIN = /^https:\/\/beheer\.bingr\.online$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const SITE_ORIGIN = /^https:\/\/(www\.)?bingr\.online$/;
const PUBLIC_ACTIONS = new Set(["unsubscribe"]);

// action = null: preflight (OPTIONS), de actie is dan nog niet bekend
function corsFor(req: Request, action: string | null): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const ok = BEHEER_ORIGIN.test(origin) || (SITE_ORIGIN.test(origin) && (action === null || PUBLIC_ACTIONS.has(action)));
  return {
    ...(ok ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

// ---- crypto ----
const enc = new TextEncoder();
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function sha256(s: string) { return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
async function hmacKey(material: string) {
  return crypto.subtle.importKey("raw", await sha256(material), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
async function hmac(material: string, data: string) {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(material), enc.encode(data)));
}
// sleutel voor beheer-tokens: wijzigt het wachtwoord, dan vervallen alle tokens
const adminMaterial = () => `bingr-admin-v1|${env("BINGR_ADMIN_PASSWORD")}|${env("SUPABASE_SERVICE_ROLE_KEY")}`;
// sleutel voor afmeldlinks: blijft geldig (BINGR_SOURCES_KEY wordt nooit vervangen)
const unsubMaterial = () => `bingr-unsub-v1|${env("BINGR_SOURCES_KEY") || env("SUPABASE_SERVICE_ROLE_KEY")}`;

async function makeToken() {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = b64u(enc.encode(JSON.stringify({ u: env("BINGR_ADMIN_USER"), exp })));
  return { token: `${payload}.${b64u(await hmac(adminMaterial(), payload))}`, expires_at: new Date(exp).toISOString() };
}
async function validToken(token: unknown) {
  if (!env("BINGR_ADMIN_PASSWORD") || typeof token !== "string" || token.length > 500) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  try {
    if (!sameBytes(unb64u(sig), await hmac(adminMaterial(), payload))) return false;
    const p = JSON.parse(new TextDecoder().decode(unb64u(payload)));
    return p.u === env("BINGR_ADMIN_USER") && typeof p.exp === "number" && p.exp > Date.now();
  } catch { return false; }
}
async function unsubToken(userId: string) {
  return `${userId}.${b64u((await hmac(unsubMaterial(), `unsub:${userId}`)).subarray(0, 18))}`;
}
async function unsubUser(t: unknown): Promise<string | null> {
  if (typeof t !== "string" || t.length > 120) return null;
  const [id, sig] = t.split(".");
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "") || !sig) return null;
  try {
    return sameBytes(unb64u(sig), (await hmac(unsubMaterial(), `unsub:${id}`)).subarray(0, 18)) ? id.toLowerCase() : null;
  } catch { return null; }
}

// ---- hulpjes ----
const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function maskEmail(e: unknown) {
  const s = String(e ?? "");
  const at = s.lastIndexOf("@");
  if (at < 1) return s ? "***" : "";
  const local = s.slice(0, at), domain = s.slice(at + 1);
  const ml = local.length <= 2 ? local[0] + "***" : `${local[0]}***${local[local.length - 1]}`;
  const dot = domain.lastIndexOf(".");
  const md = dot > 0 ? `${domain[0]}***${domain.slice(dot)}` : "***";
  return `${ml}@${md}`;
}
function clientIp(req: Request) {
  const f = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return (f || req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "?").slice(0, 64);
}
// Accountmails (blokkeren, opheffen, verwijderen) gaan vanaf support@ (BINGR_SUPPORT_FROM, zoals de supportmails); weigert
// de SMTP-server die afzender, dan met BINGR_SMTP_FROM als afzender en support@ als Reply-To. Antwoorden komen zo bij support.
const SUPPORT_FROM = () => env("BINGR_SUPPORT_FROM") || "Bingr Support <support@bingr.online>";
const addressOf = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim();
async function sendAccountMail(to: string, m: Mail): Promise<{ ok: boolean; error?: string }> {
  if (!smtpConfigured()) return { ok: false, error: "smtp_not_configured" };
  const base = { to, subject: m.subject, html: m.html, text: m.text, headers: { "Auto-Submitted": "auto-generated" } };
  const tx = transport();
  try {
    try {
      await tx.sendMail({ ...base, from: SUPPORT_FROM(), replyTo: addressOf(SUPPORT_FROM()) });
    } catch (e) {
      if (!smtpFrom() || addressOf(smtpFrom()).toLowerCase() === addressOf(SUPPORT_FROM()).toLowerCase()) throw e;
      console.error("account mail (support-afzender)", e instanceof Error ? e.message : e);
      await tx.sendMail({ ...base, from: smtpFrom(), replyTo: addressOf(SUPPORT_FROM()) });
    }
    return { ok: true };
  } catch (e) {
    console.error("account mail", e instanceof Error ? e.message : e);
    return { ok: false, error: "send_failed" };
  } finally { tx.close(); }
}
type AuthUser = { id: string; email?: string; user_metadata?: Record<string, unknown> };
async function authUser(id: string): Promise<AuthUser | null> {
  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error && (error as { status?: number }).status !== 404) throw new Error(error.message);
  return (data?.user as AuthUser | undefined) ?? null;
}

async function audit(action: string, ip: string, target?: string | null, detail?: unknown) {
  await admin.from("admin_audit").insert({ action, ip, target_user: target ?? null, detail: detail ?? null });
}
// afmelden met één klik (RFC 8058): de mailclient doet POST <functie-URL>?unsubscribe=<token> met List-Unsubscribe=One-Click.
// Een GET (oudere clients openen de link in de browser) gaat door naar de afmeldpagina op bingr.online; die vraagt eerst.
const oneClickUrl = (t: string) => `${env("SUPABASE_URL").replace(/\/+$/, "")}/functions/v1/admin?unsubscribe=${encodeURIComponent(t)}`;
async function unsubscribe(t: unknown): Promise<boolean> {
  const id = await unsubUser(t);
  if (!id) return false;
  const { error } = await admin.from("account_email_prefs").upsert({ user_id: id, email_opt_out: true, updated_at: new Date().toISOString() });
  // account bestaat niet meer (foreign key): er wordt toch al niets meer gestuurd
  if (error && !/foreign key/i.test(error.message)) throw new Error(error.message);
  return true;
}

Deno.serve(async (req) => {
  let cors = corsFor(req, null);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const oneClick = new URL(req.url).searchParams.get("unsubscribe");
  if (oneClick !== null) {
    const plain = (text: string, status: number) => new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    if (req.method === "GET" || req.method === "HEAD") {
      return new Response(null, { status: 303, headers: { Location: `${SITE}/unsubscribe/?t=${encodeURIComponent(oneClick)}`, "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" } });
    }
    if (req.method !== "POST") return plain("method not allowed", 405);
    try {
      return (await unsubscribe(oneClick)) ? plain("unsubscribed", 200) : plain("invalid link", 400);
    } catch (e) {
      console.error("admin", "one-click unsubscribe", e instanceof Error ? e.message : e);
      return plain("server error", 500);
    }
  }
  cors = corsFor(req, "");
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 64 * 1024) return json({ error: "too_large" }, 413);
    body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch { return json({ error: "bad_json" }, 400); }
  const action = String(body.action ?? "");
  cors = corsFor(req, action);
  // vanaf de openbare site alleen de afmeldactie (beheer draait op beheer.bingr.online)
  if (SITE_ORIGIN.test(req.headers.get("Origin") ?? "") && !PUBLIC_ACTIONS.has(action)) return json({ error: "forbidden_origin" }, 403);
  try {
    return await handle(req, body, json);
  } catch (e) {
    console.error("admin", action, e instanceof Error ? e.message : e);
    return json({ error: "server_error" }, 500);
  }
});

async function handle(req: Request, body: Record<string, unknown>, json: (b: unknown, s?: number) => Response): Promise<Response> {
  const ip = clientIp(req);
  const action = String(body.action ?? "");

  if (action === "login") {
    if (!env("BINGR_ADMIN_USER") || !env("BINGR_ADMIN_PASSWORD")) return json({ error: "not_configured" }, 503);
    const { data: gate, error: ge } = await admin.rpc("bingr_admin_gate", { p_ip: ip });
    if (ge) throw new Error(ge.message);
    if (gate?.locked) return json({ error: "locked", retry_after: gate.retry_after ?? 900 }, 429);
    // altijd allebei vergelijken, op hashes van gelijke lengte (geen timing-verschil)
    const [a, b, c, d] = await Promise.all([sha256(String(body.user ?? "")), sha256(env("BINGR_ADMIN_USER")),
      sha256(String(body.password ?? "")), sha256(env("BINGR_ADMIN_PASSWORD"))]);
    const ok = sameBytes(a, b) && sameBytes(c, d);
    await admin.rpc("bingr_admin_result", { p_ip: ip, p_ok: ok });
    await audit(ok ? "login" : "login_failed", ip);
    if (!ok) return json({ error: "invalid_credentials" }, 401);
    return json(await makeToken());
  }

  if (action === "unsubscribe") {
    if (!(await unsubscribe(body.t))) return json({ error: "invalid_token" }, 400);
    return json({ ok: true });
  }

  if (!(await validToken(body.token))) return json({ error: "not_signed_in" }, 401);

  switch (action) {
    case "stats": {
      const { data, error } = await admin.rpc("bingr_admin_stats");
      if (error) throw new Error(error.message);
      return json({ ...data, smtp: smtpConfigured() });
    }
    case "users": {
      const size = Math.min(Math.max(Number(body.page_size ?? 25) || 25, 1), 50);
      const page = Math.max(Math.floor(Number(body.page ?? 0) || 0), 0);
      const q = String(body.q ?? "").trim().toLowerCase().slice(0, 100);
      // filter alleen meesturen als hij gekozen is (zo werkt de lijst ook met een ouder schema)
      const { data, error } = await admin.rpc("bingr_admin_users", {
        p_search: q, p_limit: size, p_offset: page * size,
        ...(["blocked", "free", "lifetime", "custom"].includes(String(body.filter)) ? { p_filter: String(body.filter) } : {}),
      });
      if (error) throw new Error(error.message);
      const items = (data?.items ?? []).map((u: Record<string, unknown>) => ({ ...u, email: maskEmail(u.email) }));
      return json({
        total: data?.total ?? 0, blocked_total: data?.blocked_total ?? null, lifetime_total: data?.lifetime_total ?? null,
        free_total: data?.free_total ?? null, page, page_size: size, items,
      });
    }
    case "user_detail": {
      if (!isUuid(body.id)) return json({ error: "bad_id" }, 400);
      const { data, error } = await admin.rpc("bingr_admin_user", { p_id: body.id });
      if (error) throw new Error(error.message);
      if (!data) return json({ error: "not_found" }, 404);
      return json({ ...data, email: maskEmail(data.email) });
    }
    case "plan_get": {
      if (!isUuid(body.id)) return json({ error: "bad_id" }, 400);
      const { data, error } = await admin.from("account_plans").select("*").eq("user_id", String(body.id).toLowerCase()).maybeSingle();
      if (error) throw new Error(error.message);
      return json(planView(data));
    }
    case "plan_set": {
      if (!isUuid(body.id)) return json({ error: "bad_id" }, 400);
      const id = String(body.id).toLowerCase();
      if (body.plan !== "free" && body.plan !== "lifetime") return json({ error: "bad_plan" }, 400);
      const ms = limitInput(body.max_streams, 50), md = limitInput(body.max_devices, 200);
      if (ms === undefined) return json({ error: "bad_max_streams" }, 400);
      if (md === undefined) return json({ error: "bad_max_devices" }, 400);
      const note = String(body.note ?? "").trim().slice(0, 500) || null;
      if (!(await authUser(id))) return json({ error: "not_found" }, 404);
      const { data: before } = await admin.from("account_plans").select("plan,max_streams,max_devices,source").eq("user_id", id).maybeSingle();
      let row: Record<string, unknown> | null = null;
      if (body.plan === "free" && ms === null && md === null && !note) {
        // gewoon Gratis: geen rij nodig
        const { error } = await admin.from("account_plans").delete().eq("user_id", id);
        if (error) throw new Error(error.message);
      } else {
        // bron: een gekochte Lifetime blijft 'purchase' zolang het Lifetime blijft; anders 'admin'
        const source = before?.source === "purchase" && body.plan === "lifetime" ? "purchase" : "admin";
        const { data, error } = await admin.from("account_plans").upsert({
          user_id: id, plan: body.plan, max_streams: ms, max_devices: md, note, source,
          granted_by: "beheer", updated_at: new Date().toISOString(),
        }).select("*").single();
        if (error) throw new Error(error.message);
        row = data;
      }
      await audit("plan_set", ip, id, { from: before ?? { plan: "free" }, plan: body.plan, max_streams: ms, max_devices: md, note: note ? true : undefined });
      return json({ ok: true, ...planView(row) });
    }
    case "app_settings_get": {
      const { data, error } = await admin.from("app_settings").select("value").eq("key", "upgrade_link").maybeSingle();
      if (error) throw new Error(error.message);
      return json({ upgrade_link: linkView(data?.value) });
    }
    case "app_settings_set": {
      const v = body.upgrade_link;
      if (!v || typeof v !== "object" || Array.isArray(v)) return json({ error: "bad_settings" }, 400);
      const o = v as Record<string, unknown>;
      if (!LINK_KEYS.every((k) => typeof o[k] === "boolean")) return json({ error: "bad_settings" }, 400);
      const value = Object.fromEntries(LINK_KEYS.map((k) => [k, o[k]]));
      const { error } = await admin.from("app_settings").upsert({ key: "upgrade_link", value, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      await audit("app_settings_set", ip, null, { upgrade_link: value });
      return json({ ok: true, upgrade_link: value });
    }
    case "send_reset": {
      if (!isUuid(body.user_id)) return json({ error: "bad_id" }, 400);
      const { data: u } = await admin.auth.admin.getUserById(String(body.user_id));
      const email = u?.user?.email;
      if (!email) return json({ error: "not_found" }, 404);
      const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo: `${SITE}/reset/` });
      if (error) {
        const st = (error as { status?: number }).status ?? 500;
        console.error("send_reset", error.message);
        return json({ error: st === 429 ? "too_soon" : "reset_failed" }, st === 429 ? 429 : 502);
      }
      await audit("send_reset", ip, String(body.user_id));
      return json({ ok: true });
    }
    case "user_block": {
      if (!isUuid(body.id)) return json({ error: "bad_id" }, 400);
      const id = String(body.id).toLowerCase();
      const reason = cleanReason(body.reason);
      if (!reason) return json({ error: "reason_missing" }, 400);
      const u = parseUntil(body.until);
      if (!u.ok) return json({ error: u.error }, 400);
      const user = await authUser(id);
      if (!user) return json({ error: "not_found" }, 404);
      const { error: be } = await admin.auth.admin.updateUserById(id, { ban_duration: banDuration(u.until) });
      if (be) { console.error("user_block", be.message); return json({ error: "block_failed" }, 502); }
      const until = u.until?.toISOString() ?? null;
      // een vorige blokkade die nog liep, is hiermee vervangen
      await admin.from("account_blocks").update({ lifted_at: new Date().toISOString(), lifted_by: "vervangen" }).eq("user_id", id).is("lifted_at", null);
      const { data: row, error: ie } = await admin.from("account_blocks").insert({ user_id: id, reason, until }).select("id").single();
      if (ie) throw new Error(ie.message);
      // Sessies NIET intrekken: met een bestaande sessie geeft het vernieuwen door de ban de fout user_banned, en daaraan
      // herkennen de apps (build 82) en de website dat het account geblokkeerd is (melding in plaats van gewoon uitloggen).
      // device-auth weigert lopende access tokens van een geblokkeerd account met 401 {error:"user_banned", banned:true}.
      // Lopende streams tellen meteen niet meer mee.
      const { data: stopped, error: se } = await admin.from("account_streams").delete().eq("user_id", id).select("user_id");
      if (se) console.error("user_block streams", se.message);
      let mail: { ok: boolean; error?: string } = { ok: false };
      if (body.notify !== false && user.email) {
        mail = await sendAccountMail(user.email, blockMail(accountLang(user.user_metadata?.lang), { email: user.email, reason, until: u.until }));
        if (mail.ok) await admin.from("account_blocks").update({ notified: true }).eq("id", row.id);
      }
      await audit("user_block", ip, id, { until, notify: body.notify !== false, email_sent: mail.ok, streams: stopped?.length ?? null, length: reason.length });
      return json({ ok: true, id: row.id, until, streams_stopped: stopped?.length ?? 0, email_sent: mail.ok, email_error: mail.error });
    }
    case "user_unblock": {
      if (!isUuid(body.id)) return json({ error: "bad_id" }, 400);
      const id = String(body.id).toLowerCase();
      const user = await authUser(id);
      if (!user) return json({ error: "not_found" }, 404);
      const { error: be } = await admin.auth.admin.updateUserById(id, { ban_duration: "none" });
      if (be) { console.error("user_unblock", be.message); return json({ error: "unblock_failed" }, 502); }
      const { data: lifted } = await admin.from("account_blocks").update({ lifted_at: new Date().toISOString(), lifted_by: "beheer" })
        .eq("user_id", id).is("lifted_at", null).select("id");
      let mail: { ok: boolean; error?: string } = { ok: false };
      if (body.notify !== false && user.email) {
        mail = await sendAccountMail(user.email, unblockMail(accountLang(user.user_metadata?.lang), { email: user.email }));
      }
      await audit("user_unblock", ip, id, { notify: body.notify !== false, email_sent: mail.ok, lifted: lifted?.length ?? 0 });
      return json({ ok: true, email_sent: mail.ok, email_error: mail.error });
    }
    case "user_delete": {
      if (!isUuid(body.id)) return json({ error: "bad_id" }, 400);
      const id = String(body.id).toLowerCase();
      const user = await authUser(id);
      if (!user) return json({ error: "not_found" }, 404);
      const email = user.email ?? "";
      if (!confirmMatches(body.confirm, email, maskEmail(email))) return json({ error: "confirm_mismatch" }, 400);
      const notify = body.notify !== false && !!email;
      const delTickets = body.delete_tickets === true;
      // e-mailadres en taal vastleggen vóór het verwijderen; de mail gaat pas als het verwijderen gelukt is
      const mail = notify ? deletedMail(accountLang(user.user_metadata?.lang), { email, ticketsDeleted: delTickets }) : null;
      // profielfoto's (opslag gaat niet mee met de cascade)
      for (let i = 0; i < 20; i++) {
        const { data: files, error: le } = await admin.storage.from("avatars").list(id, { limit: 1000 });
        if (le || !files?.length) break;
        const { error: rm } = await admin.storage.from("avatars").remove(files.map((f) => `${id}/${f.name}`));
        if (rm) { console.error("user_delete avatars", rm.message); break; }
      }
      // supporttickets: standaard bewaard (user_id wordt leeg via on delete set null); op verzoek ook verwijderd
      let ticketsDeleted = 0;
      if (delTickets) {
        const { data: a } = await admin.from("support_tickets").delete().eq("user_id", id).select("id");
        const { data: b } = email ? await admin.from("support_tickets").delete().ilike("email", email.replace(/[\\%_]/g, "\\$&")).select("id") : { data: [] };
        ticketsDeleted = (a?.length ?? 0) + (b?.length ?? 0);
      }
      // de gebruiker zelf; alle tabellen (profielen, servers, instellingen, apparaten, sessies, streams, kijkgeschiedenis,
      // statistieken, blokkades, e-mailvoorkeuren, tv-codes) gaan mee via on delete cascade
      const { error: de } = await admin.auth.admin.deleteUser(id);
      if (de) { console.error("user_delete", de.message); return json({ error: "delete_failed" }, 502); }
      const sent = mail ? await sendAccountMail(email, mail) : { ok: false };
      await audit("user_delete", ip, id, {
        email: maskEmail(email), notify, email_sent: sent.ok, tickets_deleted: delTickets ? ticketsDeleted : undefined,
        reason: cleanReason(body.reason).slice(0, 500) || undefined,
      });
      return json({ ok: true, email_sent: sent.ok, email_error: sent.error, tickets_deleted: ticketsDeleted });
    }
    case "announce": {
      const t = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
      const row = {
        title_nl: t(body.title_nl, 120), body_nl: t(body.body_nl, 4000),
        title_en: t(body.title_en, 120), body_en: t(body.body_en, 4000),
        expires_at: null as string | null, email: body.email === true, email_total: 0,
      };
      if (!row.title_nl || !row.body_nl) return json({ error: "text_missing" }, 400);
      if (body.expires_at) {
        const ms = Date.parse(String(body.expires_at));
        if (!Number.isFinite(ms) || ms < Date.now()) return json({ error: "bad_expires_at" }, 400);
        row.expires_at = new Date(ms).toISOString();
      }
      if (row.email) {
        if (!smtpConfigured()) return json({ error: "smtp_not_configured" }, 400);
        const { data: n, error } = await admin.rpc("bingr_email_recipients");
        if (error) throw new Error(error.message);
        row.email_total = Number(n ?? 0);
      }
      const { data, error } = await admin.from("announcements").insert(row).select("id").single();
      if (error) throw new Error(error.message);
      await audit("announce", ip, null, { id: data.id, email: row.email, email_total: row.email_total });
      return json({ ok: true, id: data.id, email_total: row.email_total });
    }
    case "announce_send": {
      if (!isUuid(body.id)) return json({ error: "bad_id" }, 400);
      if (!smtpConfigured()) return json({ error: "smtp_not_configured" }, 400);
      const { data: a } = await admin.from("announcements").select("title_nl,body_nl,title_en,body_en").eq("id", body.id).maybeSingle();
      if (!a) return json({ error: "not_found" }, 404);
      const { data: claim, error } = await admin.rpc("bingr_announce_claim", { p_id: body.id, p_batch: BATCH });
      if (error) throw new Error(error.message);
      let sent = 0, failed = 0;
      const items: { id: string; email: string; lang: string | null }[] = claim?.items ?? [];
      if (items.length) {
        const tx = transport();
        try {
          for (const r of items) {
            const en = r.lang !== "nl" && !!a.title_en && !!a.body_en;
            const tok = await unsubToken(r.id);
            const url = `${SITE}/unsubscribe/?t=${encodeURIComponent(tok)}`;
            const m = announcementMail(en ? "en" : "nl", en ? a.title_en : a.title_nl, en ? a.body_en : a.body_nl, url);
            try {
              await tx.sendMail({
                from: env("BINGR_SMTP_FROM"), to: r.email, subject: m.subject, text: m.text, html: m.html,
                headers: { "List-Unsubscribe": `<${oneClickUrl(tok)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
              });
              sent++;
            } catch (e) {
              failed++;
              console.error("announce_send", e instanceof Error ? e.message : e);
            }
            await new Promise((r) => setTimeout(r, 150));
          }
        } finally { tx.close(); }
      }
      const { data: rep, error: re } = await admin.rpc("bingr_announce_report", { p_id: body.id, p_sent: sent, p_failed: failed });
      if (re) throw new Error(re.message);
      if (rep?.done || claim?.done) await audit("announce_email", ip, null, { id: body.id, ...rep });
      return json({ ...rep, done: !!(rep?.done || claim?.done), batch_sent: sent, batch_failed: failed });
    }
    case "announcements_list": {
      const { data, error } = await admin.from("announcements")
        .select("id,title_nl,body_nl,title_en,body_en,created_at,expires_at,email,email_total,email_sent,email_failed,email_done_at")
        .order("created_at", { ascending: false }).limit(50);
      if (error) throw new Error(error.message);
      const cut = Date.now() - 30 * 864e5;
      const items = (data ?? []).map((a) => ({
        ...a, active: Date.parse(a.created_at) > cut && (!a.expires_at || Date.parse(a.expires_at) > Date.now()),
      }));
      return json({ items, smtp: smtpConfigured() });
    }
    case "announcement_delete": {
      if (!isUuid(body.id)) return json({ error: "bad_id" }, 400);
      const { error } = await admin.from("announcements").delete().eq("id", body.id);
      if (error) throw new Error(error.message);
      await audit("announcement_delete", ip, null, { id: body.id });
      return json({ ok: true });
    }
    case "status": {
      // tab Status: doorgeven aan de functie `status` met het geheim (staat alleen op de server)
      const op = String(body.op ?? "");
      const map: Record<string, string> = {
        overview: "admin", checks: "checks", monitor_save: "monitor_save", monitor_delete: "monitor_delete", run: "run",
        notice_save: "notice_save", notice_update: "notice_update", notice_delete: "notice_delete", subscribers: "subscribers", mail_run: "mail_run",
      };
      if (!map[op]) return json({ error: "unknown_action" }, 400);
      if (!env("STATUS_CRON_SECRET")) return json({ error: "status_not_configured" }, 503);
      const { action: _a, token: _t, op: _o, ...rest } = body;
      const res = await fetch(`${env("SUPABASE_URL").replace(/\/+$/, "")}/functions/v1/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-status-secret": env("STATUS_CRON_SECRET") },
        body: JSON.stringify({ ...rest, action: map[op], ...(op === "run" ? { force: true, source: "admin" } : {}) }),
        signal: AbortSignal.timeout(60000),
      });
      const out = await res.json().catch(() => ({ error: "server_error" }));
      if (["monitor_save", "monitor_delete", "run", "notice_save", "notice_update", "notice_delete", "mail_run"].includes(op) && res.ok) {
        await audit(`status_${op}`, ip, null, op === "run" ? { checked: out.checked, down: out.down }
          : op === "mail_run" ? { sent: out.sent ?? 0 }
          : op.startsWith("notice_") ? { id: out.id ?? rest.id, status: rest.status, notify: rest.notify !== false } : { id: out.id ?? rest.id });
      }
      return json(out, res.status);
    }
    case "support_counts": case "support_list": case "support_get":
    case "support_reply": case "support_status": case "support_note": case "support_inbox": case "support_poll": {
      // tab Support: doorgeven aan de functie `support` met het geheim (staat alleen op de server)
      if (!env("SUPPORT_ADMIN_SECRET")) return json({ error: "support_not_configured" }, 503);
      const { action: _a, token: _t, ...rest } = body;
      const res = await fetch(`${env("SUPABASE_URL").replace(/\/+$/, "")}/functions/v1/support`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-support-secret": env("SUPPORT_ADMIN_SECRET") },
        body: JSON.stringify({ ...rest, action: action.replace(/^support_/, "admin_") }),
        signal: AbortSignal.timeout(60000),
      });
      const out = await res.json().catch(() => ({ error: "server_error" }));
      if (res.status === 403) return json({ error: "support_forbidden" }, 502);
      if (res.status === 404 && !out?.error) return json({ error: "support_not_deployed" }, 503);
      if (res.ok && action === "support_poll") {
        await audit(action, ip, null, { ok: out.ok ?? null, fetched: out.fetched, imported: out.imported, agent: out.agent, new_tickets: out.new_tickets, skipped: out.skipped ? true : undefined });
      }
      if (res.ok && ["support_reply", "support_status", "support_note"].includes(action)) {
        // geen berichttekst in het logboek, alleen wat er gebeurde
        await audit(action, ip, null, {
          number: rest.number, status: out.status ?? undefined, priority: action === "support_status" ? out.priority : undefined,
          email_sent: out.email_sent ?? undefined, length: typeof rest.message === "string" ? rest.message.length : undefined,
        });
      }
      return json(out, res.status);
    }
    default:
      return json({ error: "unknown_action" }, 400);
  }
}
