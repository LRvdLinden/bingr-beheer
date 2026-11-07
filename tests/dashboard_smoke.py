#!/usr/bin/env python3
"""Rooktest van het web-dashboard (web/) met een gesimuleerde functie `admin`: geen netwerk, geen echte gegevens.

Serveert web/ lokaal, onderschept alle aanroepen naar functions/v1/admin en geeft antwoorden in de vorm van de
actuele contracten (insights.ts: metrics en series worden uit supabase/functions/admin/insights.ts gelezen). Opent de
tab Insights met alle bronnen aangevinkt en faalt bij JS-fouten, console-errors of ontbrekende bronnen/periodes/grafieken.
Daarna de tab Downloads, kaart Versies (releases.ts): laden, "Neem nieuwste build", voorbeeldbadge en opslaan.
Daarna de tab Lifetime-only (lifetime.ts, build 167): laden, opslaan met bevestiging, codes droog en echt, mail droog en
versturen in batches (nep-antwoorden; er gaat niets naar Stripe of naar een mailbox).
Daarna de tab Nieuwsbrief, blok Eigen mailing (mailing.ts): doelgroep met waarschuwing bij een servicebericht, voorbeeld,
testmail, versturen met bevestiging, voortgang en annuleren (alleen nep-antwoorden; er gaat nergens een mail heen).
Daarna de tab Omzet, blok Website en Apple (apple_revenue.ts): website en Apple apart, "Apple bijgewerkt t/m", de reeksen
Website en Apple in de grafiek, Apple-omzet bijwerken in stukken van 31 dagen, commissie en koersen opslaan
(tests/fixtures/revenue_apple.json, verzonnen bedragen; maken met tests/make_revenue_fixture.ts).

Gebruik: python3 tests/dashboard_smoke.py [--channel chrome]   (pip install playwright; lokaal: playwright install chromium)
"""
import functools, http.server, json, re, sys, threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
INSIGHTS_TS = (ROOT / "supabase/functions/admin/insights.ts").read_text()


def metrics_from_ts():
    """{metric: {label, unit, series: [(key, label, agg)]}} uit METRICS in insights.ts (bron van het contract)."""
    block = INSIGHTS_TS.split("export const METRICS", 1)[1].split("\n};", 1)[0]
    out = {}
    for m in re.finditer(r"\n  (\w+): \{\s*label: \"([^\"]+)\", unit: \"([^\"]+)\",\s*series: \[(.*?)\],?\s*\n?\s*\},", block, re.S):
        series = re.findall(r'\{ key: "(\w+)", label: "([^"]+)", agg: "(\w+)"', m.group(4))
        out[m.group(1)] = {"label": m.group(2), "unit": m.group(3), "series": series}
    return out


METRICS = metrics_from_ts()
PERIODS = re.search(r"export const PERIODS = \[([^\]]+)\]", INSIGHTS_TS).group(1).replace('"', "").replace(" ", "").split(",")


def insights_answer(req):
    """InsightsOut (insights.ts build()) met 7 dagen en nepaantallen; nooit gegevens per persoon."""
    m = METRICS.get(req.get("metric"))
    if not m or req.get("period") not in PERIODS:
        return 400, {"error": "bad_metric" if not m else "bad_period"}
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = now - timedelta(days=6)
    edges = [start + timedelta(days=i) for i in range(8)]
    iso = lambda t: t.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    series = []
    for i, (key, label, agg) in enumerate(m["series"]):
        vals = [(j * 3 + i * 5) % 11 for j in range(7)]
        prev = [(j * 2 + i) % 9 for j in range(7)]
        series.append({"key": key, "label": label, "agg": agg, "available": True, "values": vals, "prev_values": prev,
                       "summary": {"total": sum(vals), "avg": round(sum(vals) / 7, 1), "min": min(vals), "max": max(vals),
                                   "last": vals[-1], "prev": sum(prev), "change_pct": 12.5}})
    out = {"metric": req["metric"], "label": m["label"], "unit": m["unit"], "period": req["period"], "offset": req.get("offset", 0),
           "step": "day", "tz": "Europe/Amsterdam", "from": iso(edges[0]), "to": iso(edges[-1]), "edges": [iso(t) for t in edges],
           "prev_from": iso(edges[0] - timedelta(days=7)), "prev_to": iso(edges[0]), "now_index": 6, "has_prev": True,
           "has_next": req.get("offset", 0) < 0, "series": series}
    if req.get("events"):
        out["events"] = [{"kind": "maintenance", "name": "Onderhoud", "from": iso(edges[2]), "to": iso(edges[2] + timedelta(hours=2))}]
    return 200, out


MAILING = {"active": None, "sent": []}


def mailing_answer(req):
    """Nep-antwoorden voor de eigen mailing (contract supabase/functions/admin/mailing.ts); alleen aantallen."""
    a = req["action"]
    if a == "mailing_status":
        act = MAILING["active"]
        return 200, {"active": act, "mailings": ([act] if act else []) + MAILING["sent"],
                     "audiences": {"newsletter": {"nl": 1000, "en": 234, "total": 1234}, "service": {"nl": 1100, "en": 300, "total": 1400}},
                     "per_hour": 200, "batch": 50, "sent_last_hour": 0}
    c = req.get("content") or {}
    if a == "mailing_render":
        lang = req.get("lang", "nl")
        subj = (c.get(lang) or {}).get("subject", "")
        return 200, {"subject": subj, "html": f'<!doctype html><html lang="{lang}"><body style="margin:0;background:#000000"><table role="presentation"><tr><td style="color:#ffffff;font-size:30px">BINGR</td></tr><tr><td><h1 style="color:#ffffff">{subj}</h1></td></tr></table></body></html>'}
    if a == "mailing_test":
        return (200, {"ok": True, "sent": 2 if req.get("lang") == "both" else 1}) if req.get("to") else (400, {"error": "bad_email"})
    if a == "mailing_send":
        if not re.fullmatch(r"[0-9a-f-]{36}", req.get("request_id", "")) or req.get("audience") not in ("newsletter", "service"):
            return 400, {"error": "bad_request_id"}
        MAILING["active"] = {"id": 7, "created_at": datetime.now(timezone.utc).isoformat(), "finished_at": None, "audience": req["audience"],
                             "status": "sending", "subject": {"nl": c["nl"]["subject"], "en": c["en"]["subject"]},
                             "recipients": {"nl": 1000, "en": 234, "total": 1234}, "sent": 300, "failed": 2, "skipped": 1, "cancelled": 0, "left": 931}
        return 200, {"ok": True, "id": 7, "duplicate": False, "recipients": {"nl": 1000, "en": 234, "total": 1234}}
    if a == "mailing_cancel":
        act = MAILING["active"]
        if not act:
            return 409, {"error": "not_active"}
        MAILING["sent"].insert(0, {**act, "status": "cancelled", "cancelled": act["left"], "left": 0})
        MAILING["active"] = None
        return 200, {"ok": True, "cancelled": 931}
    return 200, {}


RELEASES = {"apple": {"live": {"version": "1.0.2", "build": 152}, "beta": None}, "android": {"live": None, "beta": None}, "updatedAt": None}
SAVED = []


LT = {"lifetime_only": {"enabled": False, "announce_at": None, "cutover_at": None, "discount_pct": 30, "code_valid_until": None, "trial_days": 0,
                        "new_paid_from": None, "new_paid_from_apple": None},
      "iap": {"apple": False}, "upgrade_link": {"apple_eu": False}}
LT_SETS, LT_GEN, LT_MAIL = [], [], []


def lifetime_answer(req):
    """Nep-antwoorden in de vorm van lifetime.ts (zoals docs/ACCOUNT.md Build 167); alleen aantallen."""
    a = req.get("action")
    if a == "lifetime_settings":
        if "set" not in req:
            return 200, {**LT, "suggested_cutover_at": "2026-12-01T00:00:00+01:00", "suggested_code_valid_until": "2026-12-01T00:00:00+01:00"}
        st = req["set"]
        if st["lifetime_only"]["enabled"] and not LT["lifetime_only"]["enabled"] and not req.get("confirm"):
            return 409, {"error": "confirm_required", "confirm": ["enable"]}
        # build 168: een nieuwe datum "nieuwe accounts eerst kopen" vraagt bevestiging, met de waarschuwing zonder koopknop
        need = [k for k, f in (("new_paid", "new_paid_from"), ("new_paid_apple", "new_paid_from_apple"))
                if st["lifetime_only"].get(f) and st["lifetime_only"].get(f) != LT["lifetime_only"].get(f)]
        if need and not req.get("confirm"):
            warn = ["new_paid_apple_no_iap"] if st["lifetime_only"].get("new_paid_from_apple") and not st["iap"]["apple"] else []
            return 409, {"error": "confirm_required", "confirm": need, "warnings": warn}
        LT_SETS.append(req)
        LT["lifetime_only"].update(st["lifetime_only"]); LT["iap"] = st["iap"]; LT["upgrade_link"] = st["upgrade_link"]
        return 200, {"ok": True, **LT}
    if a == "lifetime_codes_stats":
        return 200, {"created": 120, "ready": 118, "pending_stripe": 2, "mailed": 100, "mail_error": 2, "reminded": 0, "remind_error": 0,
                     "redeemed": 9, "expired": 0, "open": 111, "candidates": 5, "mail_pending": 18, "remind_pending": 0, "unclaimed": 1}
    if a == "lifetime_codes_generate":
        LT_GEN.append(req)
        if req.get("dry_run", True):
            return 200, {"dry_run": True, "candidates": 5, "pending_stripe": 0, "created": 0, "stripe_created": 0, "stripe_errors": 0,
                         "remaining": 0, "done": True, "coupon": "bingr_lifetime_30_20261201", "valid_until": "2026-12-01T00:00:00+01:00",
                         "discount_pct": 30, "mode": "live"}
        if not req.get("confirm"):
            return 409, {"error": "confirm_required", "confirm": ["generate"]}
        n = sum(1 for g in LT_GEN if g.get("dry_run") is False)
        return 200, {"dry_run": False, "candidates": 0, "pending_stripe": 0, "created": 3 if n == 1 else 2, "stripe_created": 3 if n == 1 else 2,
                     "stripe_errors": 0, "remaining": 2 if n == 1 else 0, "done": n > 1, "coupon": None, "valid_until": None, "discount_pct": None, "mode": None}
    if a == "lifetime_mail":
        LT_MAIL.append(req)
        m = req.get("mode")
        base = {"mode": m, "notice_pending": 100, "remind_pending": 0, "remind_window": False, "enabled": True, "smtp": True,
                "sent": 0, "failed": 0, "retry": 0, "errors": {}, "remaining": 0, "done": True}
        if m == "dry_run":
            return 200, base
        if m == "preview":
            return 200, {"subject": "Bingr wordt Lifetime – met 30% korting voor jou", "html": "<html><body><p>BINGR-ABCD-EFGH</p></body></html>"}
        if m == "test":
            return 200, {**base, "sent": 2}
        if not req.get("confirm"):
            return 409, {"error": "confirm_required", "confirm": [m]}
        n = sum(1 for x in LT_MAIL if x.get("mode") == m)
        return 200, {**base, "sent": 50, "remaining": 50 if n == 1 else 0, "done": n > 1}
    return 400, {"error": "unknown_action"}


REVENUE = json.loads((ROOT / "tests/fixtures/revenue_apple.json").read_text())
APPLE_REFRESH, APPLE_SET = [], []


def answer(req):
    a = req.get("action")
    if a == "revenue":
        return 200, REVENUE
    if a == "apple_sales_refresh":
        APPLE_REFRESH.append((req.get("from"), req.get("to")))
        return 200, {"configured": True, "days": 31, "ok": 20, "empty": 10, "not_ready": 1, "failed": 0, "rows": 40, "through": "2026-11-05", "error": None}
    if a == "revenue_apple_set":
        APPLE_SET.append(req)
        return 200, {"ok": True, "fx_rates": {"USD": 0.95}, "commission": 30}
    if str(a).startswith("lifetime_"):
        return lifetime_answer(req)
    if a == "purchases_unclaimed":
        return 200, {"total": 2, "paid": 1, "items": [
            {"id": 12, "provider": "stripe", "status": "paid", "amount": 499, "currency": "eur", "paid_at": "2026-12-08T10:00:00Z", "created_at": None, "mode": "live", "email_known": True},
            {"id": 13, "provider": "apple", "status": "pending", "amount": 499, "currency": "eur", "paid_at": None, "created_at": "2026-12-08T11:00:00Z", "mode": "test", "email_known": False}]}
    if a == "releases_get":
        return 200, {"releases": RELEASES}
    if a == "releases_set":
        SAVED.append(req.get("releases"))
        return 200, {"ok": True, "releases": RELEASES}
    if a == "builds":
        return 200, {"ready": True, "updated": "2026-10-30T10:00:00Z", "release_push": {}, "platforms": {
            "apple": {"version": "1.0.3", "build": 154, "file": "Bingr-1.0.3-154-Xcode.zip", "size": 1000, "uploaded_at": "2026-10-30T09:00:00Z", "history": []},
            "android": {"version": "1.0.3", "build": 154, "file": "Bingr-1.0.3-154.apk", "size": 1000, "date": "2026-10-29", "history": []}}}
    if a == "insights":
        return insights_answer(req)
    if a == "support_counts":
        return 200, {"new": 0, "open": 0, "pending": 0}
    if str(a).startswith("mailing_"):
        return mailing_answer(req)
    if a == "newsletter_set_sections":
        keys = [k for k in ("top10", "popular", "monthly", "recap") if isinstance(req.get(k), bool)]
        return (200, {"ok": True, "sections": {k: req.get(k, True) for k in ("top10", "popular", "monthly", "recap")}}) if keys else (400, {"error": "bad_sections"})
    if a == "newsletter_status":
        return 200, {"enabled": True, "next": None, "recipients": {"nl": 1000, "en": 234, "total": 1234}, "editions": [], "welcome": None,
                     "monthly": {"enabled": True, "next": {"key": "2026-11", "at": "2026-10-31T17:00:00.000Z"},
                                 "editions": [{"key": "2026-10", "created_at": "2026-09-30T16:00:03Z", "recipients": 1200, "sent": 1190, "failed": 10, "done": True}]},
                     "recap": {"enabled": True, "audience": "lifetime", "next": {"key": "2026-11", "at": "2026-12-01T19:00:00.000Z"},
                               "history": [{"month": "2026-11", "sent": 321, "failed": 2, "skipped": 4, "open": 0}]}}
    if a == "recap_render":
        return 200, {"subject": "Jouw november op Bingr", "html": "<html><body><p>BINGR maandrecap</p></body></html>", "key": "2026-11"}
    if a == "recap_preview":
        return 200, {"ok": True, "own": False}
    if a == "monthly_render":
        return 200, {"subject": "Volgende maand op Bingr: Film en meer in november", "html": "<html><body><p>BINGR maandoverzicht</p></body></html>", "key": "2026-11"}
    if a == "monthly_preview":
        return 200, {"ok": True}
    return 200, {}


def mailing_smoke(b, base, errors, calls):
    """Tab Nieuwsbrief, blok Eigen mailing. Vult errors aan; geeft het aantal geslaagde stappen terug."""
    page = b.new_page(viewport={"width": 1280, "height": 900})
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: m.type == "error" and errors.append(f"console: {m.text}"))
    dialogs = []
    page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
    page.route("**/functions/v1/admin", lambda r: route_to(r, calls))
    page.add_init_script("""
      const exp = new Date(Date.now() + 3600e3).toISOString();
      sessionStorage.setItem('bingrAdmin', JSON.stringify({ token: 'smoke', expires_at: exp }));
      sessionStorage.setItem('bingrAdmin.tab', 'newsletter');
      try { localStorage.removeItem('bingr.beheer.mailing.draft'); } catch (e) {}
    """)
    steps = 0
    def check(cond, msg):
        nonlocal steps
        if cond:
            steps += 1
        else:
            errors.append(f"eigen mailing: {msg}")
    page.goto(base + "#newsletter")
    page.wait_for_selector("#tab-newsletter:not(.hidden)", timeout=10000)
    page.wait_for_function("document.getElementById('mlCntNews').textContent.includes('1.234')", timeout=10000)
    check(page.is_enabled("#mlSend"), "Versturen niet beschikbaar bij nieuwsbrief-abonnees")
    # secties Top 10 / Populair (standaard aan; schakelaar slaat meteen op)
    check(page.is_checked("#nlSecTop10") and page.is_checked("#nlSecPopular"), "secties niet standaard aan")
    page.click("#nlSecTop10 + .track")
    page.wait_for_timeout(400)
    check(calls.count("newsletter_set_sections") == 1 and not page.is_checked("#nlSecTop10") and page.is_enabled("#nlSecTop10")
          and page.is_checked("#nlSecPopular"), "sectie Top 10 niet uitgezet")
    # maandoverzicht: standaard aan, volgende verzending, geschiedenis, voorbeeld, testmail en uitzetten (met bevestiging)
    check(page.is_checked("#moEnabled") and page.is_enabled("#moEnabled"), "maandoverzicht niet aan")
    check("november 2026" in page.inner_text("#moFacts") and "oktober 2026" in page.inner_text("#moEditions")
          and "1.190" in page.inner_text("#moEditions"), "maandoverzicht: volgende verzending of geschiedenis ontbreekt")
    page.click("#moShow")
    page.wait_for_selector("#moView:not(.hidden)", timeout=5000)
    check("november" in page.inner_text("#moSubject")
          and page.evaluate("document.getElementById('moView').shadowRoot.textContent.includes('maandoverzicht')"), "maandoverzicht: voorbeeld niet getoond")
    page.fill("#moTo", "test@example.com")
    page.click("#moSend")
    page.wait_for_timeout(300)
    check(calls.count("monthly_preview") == 1, "maandoverzicht: testmail niet aangevraagd")
    page.click("#moEnabled + .track")
    page.wait_for_timeout(400)
    check(calls.count("newsletter_set_sections") == 2 and any("maandoverzicht uitzetten" in d for d in dialogs), "maandoverzicht niet uitgezet")
    # maandrecap: alleen Lifetime, volgende verzending, geschiedenis, voorbeeld, testmail en uitzetten (met bevestiging)
    check(page.is_checked("#rcEnabled") and "Lifetime" in page.inner_text("#rcFacts") and "december" not in page.inner_text("#rcHistory")
          and "321" in page.inner_text("#rcHistory") and "november 2026" in page.inner_text("#rcHistory"), "maandrecap: stand of geschiedenis ontbreekt")
    page.click("#rcShow")
    page.wait_for_selector("#rcView:not(.hidden)", timeout=5000)
    check(page.evaluate("document.getElementById('rcView').shadowRoot.textContent.includes('maandrecap')"), "maandrecap: voorbeeld niet getoond")
    page.fill("#rcTo", "test@example.com")
    page.click("#rcSend")
    page.wait_for_timeout(300)
    check(calls.count("recap_preview") == 1, "maandrecap: testmail niet aangevraagd")
    n0 = calls.count("newsletter_set_sections")
    page.click("#rcEnabled + .track")
    page.wait_for_timeout(400)
    check(calls.count("newsletter_set_sections") == n0 + 1 and any("maandrecap uitzetten" in d for d in dialogs), "maandrecap niet uitgezet")
    page.click('input[name="mlAudience"][value="service"] + span')
    check(page.is_visible("#mlWarn"), "geen waarschuwing bij een servicebericht")
    check(not page.is_enabled("#mlSend"), "servicebericht zonder vinkje toch te versturen")
    page.check("#mlAck")
    check(page.is_enabled("#mlSend"), "servicebericht met vinkje niet te versturen")
    page.click('input[name="mlAudience"][value="newsletter"] + span')
    check(page.is_hidden("#mlWarn"), "waarschuwing blijft staan bij nieuwsbrief-abonnees")
    page.fill("#mlSubNl", "Nieuw in Bingr"); page.fill("#mlBodyNl", "# Kop\n\nTekst met **vet**.")
    page.fill("#mlSubEn", "New in Bingr"); page.fill("#mlBodyEn", "Text")
    page.click("#mlPrevNl")
    page.wait_for_selector("#mlView:not(.hidden)", timeout=5000)
    check("Nieuw in Bingr" in page.inner_text("#mlSubject"), "voorbeeld zonder onderwerp")
    check(page.evaluate("document.getElementById('mlView').shadowRoot.textContent.includes('BINGR')"), "voorbeeld niet getoond")
    page.fill("#mlTo", "test@example.com")
    page.click('#mlTestLang button[data-lang="both"]')
    page.click("#mlTest")
    page.wait_for_timeout(300)
    check(calls.count("mailing_test") == 1, "testmail niet aangevraagd")
    page.click("#mlSend")
    page.wait_for_selector("#mlActive:not(.hidden)", timeout=5000)
    check(any("1.000 krijgen de Nederlandse versie" in d for d in dialogs), "bevestiging zonder aantallen per taal")
    check("931" in page.inner_text("#mlActive"), "voortgang zonder 'te gaan'")
    check(page.evaluate("document.querySelector('#mlActive .bar span').style.width") == "25%", "voortgangsbalk niet gezet")
    check(not page.is_enabled("#mlSend"), "tweede mailing te versturen terwijl er een loopt")
    page.click("#mlCancel")
    page.wait_for_selector("#mlActive.hidden", state="attached", timeout=5000)
    check("geannuleerd" in page.inner_text("#mlList"), "geannuleerde mailing niet in de lijst")
    page.close()
    return steps


def releases_smoke(b, base, errors, calls):
    """Tab Downloads, kaart Versies. Vult errors aan; geeft het aantal geslaagde stappen terug."""
    page = b.new_page(viewport={"width": 1280, "height": 900})
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: m.type == "error" and errors.append(f"console: {m.text}"))
    page.route("**/functions/v1/admin", lambda r: route_to(r, calls))
    page.add_init_script("""
      const exp = new Date(Date.now() + 3600e3).toISOString();
      sessionStorage.setItem('bingrAdmin', JSON.stringify({ token: 'smoke', expires_at: exp }));
      sessionStorage.setItem('bingrAdmin.tab', 'downloads');
    """)
    steps = 0
    def check(cond, msg):
        nonlocal steps
        if cond:
            steps += 1
        else:
            errors.append(f"versies: {msg}")
    page.goto(base + "#downloads")
    page.wait_for_selector('#relForm [data-rel="apple.live.version"]', timeout=10000)
    page.wait_for_selector("#dlList .bld-card", timeout=10000)
    check(page.input_value('[data-rel="apple.live.version"]') == "1.0.2", "live-versie Apple niet geladen")
    check("Live 1.0.2 (152)" in page.inner_text('[data-rel-prev="apple"]'), "voorbeeldbadge Apple live ontbreekt")
    page.click('button[data-rel-take="apple"]')
    check(page.input_value('[data-rel="apple.beta.build"]') == "154" and page.input_value('[data-rel="apple.beta.date"]') == "2026-10-30",
          "nieuwste build niet ingevuld als bèta")
    check("TestFlight 1.0.3 (154)" in page.inner_text('[data-rel-prev="apple"]'), "voorbeeldbadge TestFlight ontbreekt")
    page.click('button[data-rel-take="android"]')
    page.click("#relSave")
    page.wait_for_timeout(400)
    got = SAVED[-1] if SAVED else {}
    check(got.get("apple", {}).get("beta", {}).get("build") == "154" and got.get("android", {}).get("beta", {}).get("label") == "Beta"
          and got.get("android", {}).get("live", {}).get("version") == "", f"releases_set met verkeerde inhoud: {got}")
    page.close()
    return steps


def wait_text(page, sel, text, timeout=5.0):
    """Wachten tot de tekst er staat (geen wait_for_function: de CSP van het dashboard staat geen eval toe)."""
    import time
    end = time.time() + timeout
    while time.time() < end:
        if text in page.inner_text(sel):
            return
        page.wait_for_timeout(100)
    raise AssertionError(f"{sel}: {text!r} niet gevonden in {page.inner_text(sel)!r}")


def lifetime_smoke(b, base, errors, calls):
    """Tab Lifetime-only. Vult errors aan; geeft het aantal geslaagde stappen terug."""
    page = b.new_page(viewport={"width": 1280, "height": 900})
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    # 409 confirm_required hoort erbij (eerst zonder bevestiging, dan met)
    page.on("console", lambda m: m.type == "error" and "status of 409" not in m.text and errors.append(f"console: {m.text}"))
    dialogs = []
    page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
    page.route("**/functions/v1/admin", lambda r: route_to(r, calls))
    page.add_init_script("""
      const exp = new Date(Date.now() + 3600e3).toISOString();
      sessionStorage.setItem('bingrAdmin', JSON.stringify({ token: 'smoke', expires_at: exp }));
      sessionStorage.setItem('bingrAdmin.tab', 'lifetime');
    """)
    steps = 0
    def check(cond, msg):
        nonlocal steps
        if cond:
            steps += 1
        else:
            errors.append(f"lifetime: {msg}")
    page.goto(base + "#lifetime")
    page.wait_for_selector("#tab-lifetime:not(.hidden) #ltStats .kpi", timeout=10000)
    check("Uit" in page.inner_text("#ltState"), "stand niet Uit")
    wait_text(page, "#ltUnclaimed", "2 niet geclaimd")
    check("#12 · Website (Stripe)" in page.inner_text("#ltUnclaimed") and "@" not in page.inner_text("#ltUnclaimed"), "niet geclaimde aankopen")
    check("120" in page.inner_text("#ltStats") and "5 nog te maken" in page.inner_text("#ltStats"), "totalen ontbreken")
    # aanzetten met overgang: eerst 409, dan bevestigen en opnieuw met confirm
    page.click("label:has(#ltEnabled) .track")
    # aanvulling 2: het vaste voorstel (1 december 2026 00:00) staat al ingevuld, ook voor de code
    check(page.input_value("#ltCutover") == "2026-12-01T00:00" and page.input_value("#ltValid") == "2026-12-01T00:00", "voorstel 1 december niet ingevuld")
    page.click("#ltSave")
    page.wait_for_timeout(500)
    got = LT_SETS[-1] if LT_SETS else {}
    check(got.get("confirm") is True and got["set"]["lifetime_only"]["cutover_at"] == "2026-12-01T00:00:00+01:00"
          and got["set"]["lifetime_only"]["code_valid_until"] == "2026-12-01T00:00:00+01:00", f"opslaan zonder bevestiging of verkeerde tijd: {got}")
    check(any("Lifetime-only gaat AAN" in d for d in dialogs), "geen bevestiging bij aanzetten")
    wait_text(page, "#ltState", "Aangekondigd")
    steps += 1
    page.click("#ltGenDry")
    wait_text(page, "#ltGenOut", "5 nieuwe codes")
    steps += 1
    page.click("#ltGen")
    wait_text(page, "#ltGenOut", "Aangemaakt: 5, in Stripe: 5.")
    steps += 1
    page.click("#ltPreview")
    wait_text(page, "#ltSubject", "Bingr wordt Lifetime")
    steps += 1
    page.click("#ltMailDry")
    wait_text(page, "#ltMailOut", "mail 100 te versturen")
    steps += 1
    page.click("#ltMailSend")
    wait_text(page, "#ltMailOut", "Verstuurd: 100.")
    sends = [m for m in LT_MAIL if m.get("mode") == "send"]
    check(len(sends) == 2 and all(m.get("confirm") is True for m in sends), f"versturen niet in batches met bevestiging: {sends}")
    # build 168: nieuwe accounts eerst kopen, web en Android nu; daarna Apple met de waarschuwing (koopknop uit)
    page.click("#ltRefresh")
    page.wait_for_function("document.querySelector('#ltNpWeb') && document.querySelector('#ltNpWeb').value === ''", timeout=5000)
    page.click("#ltNpWebNow")
    check(page.input_value("#ltNpWeb") != "" and page.input_value("#ltNpApple") == "", "knop Nu vult alleen web en Android")
    n0 = len(dialogs)
    page.click("#ltSave")
    page.wait_for_timeout(500)
    got = LT_SETS[-1] if LT_SETS else {}
    lo = got.get("set", {}).get("lifetime_only", {})
    check(got.get("confirm") is True and isinstance(lo.get("new_paid_from"), str) and lo["new_paid_from"].endswith(":00+01:00")
          and lo.get("new_paid_from_apple") is None, f"web en Android niet goed opgeslagen: {lo}")
    check(any("web en Android" in d for d in dialogs[n0:]), "geen bevestiging bij nieuwe accounts web en Android")
    wait_text(page, "#ltState", "Nieuwe accounts eerst kopen: web en Android vanaf")
    page.click("#ltNpAppleNow")
    check(not page.is_hidden("#ltNpWarn") and "koopknop" in page.inner_text("#ltNpWarn"), "geen waarschuwing bij Apple zonder koopknop")
    n0 = len(dialogs)
    page.click("#ltSave")
    page.wait_for_timeout(500)
    check(any("Apple-apps eerst Lifetime kopen" in d and "koopknop" in d for d in dialogs[n0:]), f"bevestiging Apple zonder waarschuwing: {dialogs[n0:]}")
    check(isinstance(LT_SETS[-1]["set"]["lifetime_only"].get("new_paid_from_apple"), str), "Apple-datum niet opgeslagen")
    page.close()
    return steps


def revenue_smoke(b, base, errors, calls):
    """Tab Omzet, blok Website en Apple. Vult errors aan; geeft het aantal geslaagde stappen terug."""
    page = b.new_page(viewport={"width": 1280, "height": 900})
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: m.type == "error" and errors.append(f"console: {m.text}"))
    page.route("**/functions/v1/admin", lambda r: route_to(r, calls))
    page.add_init_script("""
      const exp = new Date(Date.now() + 3600e3).toISOString();
      sessionStorage.setItem('bingrAdmin', JSON.stringify({ token: 'smoke', expires_at: exp }));
      sessionStorage.setItem('bingrAdmin.tab', 'revenue');
    """)
    steps = 0
    def check(cond, msg):
        nonlocal steps
        if cond:
            steps += 1
        else:
            errors.append(f"omzet: {msg}")
    page.goto(base + "#revenue")
    page.wait_for_selector("#tab-revenue:not(.hidden) #revSrcBox:not(.hidden) #revSources table", timeout=10000)
    src = page.inner_text("#revSources")
    check("Website (Stripe)" in src and "Apple (App Store)" in src and "Totaal" in src, "kolommen website / Apple / totaal")
    check(all(x in src for x in ("Bruto", "Inhouding", "Netto opbrengst", "Aantal", "Terugbetaald")), f"regels ontbreken: {src!r}")
    check("29,94" in src and "49,90" in src, f"bruto Apple en totaal: {src!r}")
    check("Apple bijgewerkt t/m 5 november 2026" in page.inner_text("#revAppleState"), "bijgewerkt t/m")
    note = page.inner_text("#revAppleNote")
    check("4 via de app aan een account gekoppeld" in note and "JPY" in note, f"gekoppeld en niet omgerekend: {note!r}")
    legend = page.inner_text("#revMoney .ins-series")
    check("Website" in legend and "Apple" in legend, f"reeksen Website en Apple: {legend!r}")
    check(page.input_value("#revComm") == "15" and "USD = 0,92" in page.input_value("#revFx"), "commissie en koersen ingevuld")
    page.fill("#revAppleFrom", "2026-01-01")
    page.fill("#revAppleTo", "2026-11-05")
    page.click("#revAppleRun")
    page.wait_for_timeout(1500)
    days = [(f, t) for f, t in APPLE_REFRESH]
    from datetime import date
    span = lambda f, t: (date.fromisoformat(t) - date.fromisoformat(f)).days + 1
    check(len(days) == 10 and days[0][0] == "2026-01-01" and days[-1][1] == "2026-11-05" and all(span(f, t) <= 31 for f, t in days)
          and all(date.fromisoformat(days[i + 1][0]) == date.fromisoformat(days[i][1]) + timedelta(days=1) for i in range(len(days) - 1)),
          f"bijwerken niet in aansluitende stukken van max. 31 dagen: {days}")
    page.fill("#revComm", "30")
    page.fill("#revFx", "usd = 0,95")
    page.click("#revFxForm button[type=submit]")
    page.wait_for_timeout(500)
    got = APPLE_SET[-1] if APPLE_SET else {}
    check(got.get("fx_rates") == {"USD": "0.95"} and got.get("commission") == "30", f"commissie en koersen opslaan: {got}")
    page.fill("#revFx", "dollar 1")
    n0 = len(APPLE_SET)
    page.click("#revFxForm button[type=submit]")
    page.wait_for_timeout(300)
    check(len(APPLE_SET) == n0, "ongeldige koers toch verstuurd")
    page.close()
    return steps


def route_to(r, calls):
    if r.request.method == "OPTIONS":
        return r.fulfill(status=204, headers={"access-control-allow-origin": "*", "access-control-allow-headers": "*"})
    body = json.loads(r.request.post_data or "{}")
    calls.append(body.get("action"))
    status, data = answer(body)
    r.fulfill(status=status, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps(data))


def main():
    channel = sys.argv[sys.argv.index("--channel") + 1] if "--channel" in sys.argv else None
    assert len(METRICS) >= 6 and "purchases" in METRICS, f"METRICS uit insights.ts niet gelezen: {list(METRICS)}"
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Quiet, directory=str(WEB))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}/"
    errors, calls = [], []

    def route(r):
        if r.request.method == "OPTIONS":
            return r.fulfill(status=204, headers={"access-control-allow-origin": "*", "access-control-allow-headers": "*"})
        body = json.loads(r.request.post_data or "{}")
        calls.append(body.get("action"))
        status, data = answer(body)
        r.fulfill(status=status, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps(data))

    with sync_playwright() as p:
        b = p.chromium.launch(channel=channel) if channel else p.chromium.launch()
        page = b.new_page(viewport={"width": 1280, "height": 900})
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: m.type == "error" and errors.append(f"console: {m.text}"))
        page.route("**/functions/v1/admin", route)
        # alle bronnen aan, ingelogd (nep-token), tab Insights
        page.add_init_script("""
          const exp = new Date(Date.now() + 3600e3).toISOString();
          sessionStorage.setItem('bingrAdmin', JSON.stringify({ token: 'smoke', expires_at: exp }));
          sessionStorage.setItem('bingrAdmin.tab', 'insights');
          localStorage.setItem('bingrAdmin.insights', JSON.stringify({ sources: %s, period: '7d', events: true }));
        """ % json.dumps(list(METRICS)))
        page.goto(base + "#insights")
        page.wait_for_selector("#tab-insights:not(.hidden)", timeout=10000)
        try:
            page.wait_for_function(f"document.querySelectorAll('#insCharts .ins-card svg').length >= {len(METRICS)}", timeout=10000)
        except Exception:
            errors.append("niet alle grafieken getekend")
        srcs = page.eval_on_selector_all("#insSources input", "els => els.map(e => e.value)")
        periods = page.eval_on_selector_all("#insPeriods [data-p]", "els => els.map(e => e.dataset.p)")
        if sorted(srcs) != sorted(METRICS):
            errors.append(f"bronnen {srcs} != metrics {list(METRICS)}")
        if sorted(periods) != sorted(PERIODS):
            errors.append(f"periodes {periods} != {PERIODS}")
        # andere periode kiezen: opnieuw laden zonder fouten
        if periods:
            page.click('#insPeriods [data-p="30d"]')
            page.wait_for_timeout(500)
        rel_steps = releases_smoke(b, base, errors, calls)
        ml_steps = mailing_smoke(b, base, errors, calls)
        lt_steps = lifetime_smoke(b, base, errors, calls)
        rv_steps = revenue_smoke(b, base, errors, calls)
        b.close()
    srv.shutdown()
    n = calls.count("insights")
    if errors:
        for e in errors:
            print(f"::error::Insights-rooktest: {e[:300]}")
        sys.exit(1)
    print(f"Insights-rooktest OK: {len(srcs)} bronnen, {len(periods)} periodes, {n} insights-aanroepen, geen JS-fouten")
    print(f"Versies OK: {rel_steps} stappen (laden, nieuwste build, voorbeeldbadge, opslaan)")
    print(f"Lifetime-only OK: {lt_steps} stappen (laden, opslaan met bevestiging, codes droog en echt, mail droog en in batches)")
    print(f"Omzet OK: {rv_steps} stappen (website en Apple apart, bijgewerkt t/m, reeksen, bijwerken in stukken, commissie en koersen)")
    print(f"Eigen mailing OK: {ml_steps} stappen (doelgroep, waarschuwing, voorbeeld, testmail, versturen, voortgang, annuleren)")


if __name__ == "__main__":
    main()
