#!/usr/bin/env python3
"""Rooktest van het web-dashboard (web/) met een gesimuleerde functie `admin`: geen netwerk, geen echte gegevens.

Serveert web/ lokaal, onderschept alle aanroepen naar functions/v1/admin en geeft antwoorden in de vorm van de
actuele contracten (insights.ts: metrics en series worden uit supabase/functions/admin/insights.ts gelezen). Opent de
tab Insights met alle bronnen aangevinkt en faalt bij JS-fouten, console-errors of ontbrekende bronnen/periodes/grafieken.

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


def answer(req):
    a = req.get("action")
    if a == "insights":
        return insights_answer(req)
    if a == "support_counts":
        return 200, {"new": 0, "open": 0, "pending": 0}
    return 200, {}


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
        b.close()
    srv.shutdown()
    n = calls.count("insights")
    if errors:
        for e in errors:
            print(f"::error::Insights-rooktest: {e[:300]}")
        sys.exit(1)
    print(f"Insights-rooktest OK: {len(srcs)} bronnen, {len(periods)} periodes, {n} insights-aanroepen, geen JS-fouten")


if __name__ == "__main__":
    main()
