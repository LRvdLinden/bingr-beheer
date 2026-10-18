import Foundation
import SwiftUI
import UniformTypeIdentifiers

// Insights (zoals Homey Insights): tijdreeksen per periode uit de actie `insights` van de functie admin
// (supabase/functions/admin/insights.ts). Alleen aantallen per tijdvak; tijden in Nederlandse tijd. Zelfde metrics,
// periodes en kleuren als web/admin.js (INS_METRICS, INS_PERIODS, --c1…--c3).

enum InsMetric: String, CaseIterable, Identifiable, Codable {
    case accounts, signins, streams, push, support

    var id: String { rawValue }

    var name: String {
        switch self {
        case .accounts: return "Accounts"
        case .signins: return "Inlogs"
        case .streams: return "Streams"
        case .push: return "Pushmeldingen"
        case .support: return "Supporttickets"
        }
    }

    var detail: String {
        switch self {
        case .accounts: return "nieuw en actief"
        case .signins: return "inlogs per tijdvak"
        case .streams: return "live tv, films en series"
        case .push: return "verstuurd en mislukt"
        case .support: return "nieuw en gesloten"
        }
    }

    var icon: String {
        switch self {
        case .accounts: return "person.2"
        case .signins: return "key"
        case .streams: return "play.tv"
        case .push: return "bell.badge"
        case .support: return "lifepreserver"
        }
    }

    /// Series in vaste volgorde (= kleur, ook als er een uit staat).
    var series: [String] {
        switch self {
        case .accounts: return ["new_users", "active_users"]
        case .signins: return ["signins"]
        case .streams: return ["live", "movie", "episode"]
        case .push: return ["sent", "failed"]
        case .support: return ["new", "closed"]
        }
    }

    /// Automatisch: staven voor aantallen gebeurtenissen per dag of week, anders een lijn.
    func autoBars(step: String) -> Bool {
        (step == "day" || step == "week") && (self == .push || self == .support)
    }
}

enum InsPeriod: String, CaseIterable, Identifiable, Codable {
    case hour, day, week, month, year
    case h24 = "24h", d7 = "7d", d30 = "30d"

    var id: String { rawValue }

    var tab: String {
        switch self {
        case .hour: return "Uur"
        case .day: return "Dag"
        case .week: return "Week"
        case .month: return "Maand"
        case .year: return "Jaar"
        case .h24: return "24 uur"
        case .d7: return "7 dagen"
        case .d30: return "30 dagen"
        }
    }

    var long: String {
        switch self {
        case .hour: return "Uur (per 5 minuten)"
        case .day: return "Dag (per uur)"
        case .week: return "Week (per uur of dag)"
        case .month: return "Maand (per dag)"
        case .year: return "Jaar (per week)"
        case .h24: return "Laatste 24 uur"
        case .d7: return "Laatste 7 dagen"
        case .d30: return "Laatste 30 dagen"
        }
    }

    /// "t.o.v. …" in de samenvatting.
    var previous: String {
        switch self {
        case .hour: return "vorig uur"
        case .day: return "gisteren"
        case .week: return "vorige week"
        case .month: return "vorige maand"
        case .year: return "vorig jaar"
        case .h24: return "24 uur ervoor"
        case .d7: return "7 dagen ervoor"
        case .d30: return "30 dagen ervoor"
        }
    }
}

/// Kleuren van de series: categorisch palet (dataviz), donkere stappen, op #121212 gecontroleerd (ook bij kleurenblindheid).
enum InsColor {
    static let palette: [Color] = [Color(hex: 0x3987E5), Color(hex: 0xD95926), Color(hex: 0x199E70)]
    static func color(_ metric: InsMetric, _ key: String) -> Color {
        palette[max(0, min(palette.count - 1, metric.series.firstIndex(of: key) ?? 0))]
    }
    static let incident = Color(hex: 0xD03B3B)
    static let maintenance = Color(hex: 0x8EA3C0)
    static let good = Color(hex: 0x46D369)
    static let bad = Color(hex: 0xFF6B6B)
}

struct InsSummary: Hashable {
    let total: Double
    let avg: Double
    let min: Double
    let max: Double
    let last: Double?
    let changePct: Double?

    init?(_ j: JSON) {
        guard j.object != nil else { return nil }
        total = j["total"].double ?? 0
        avg = j["avg"].double ?? 0
        min = j["min"].double ?? 0
        max = j["max"].double ?? 0
        last = j["last"].double
        changePct = j["change_pct"].double
    }
}

struct InsSeries: Identifiable, Hashable {
    var id: String { key }
    let key: String
    let label: String
    /// "sum" of "avg" (actieve accounts: gemiddelde per dag)
    let agg: String
    let available: Bool
    let values: [Double?]
    let summary: InsSummary?

    /// Hoofdwaarde in de samenvatting: totaal, of het gemiddelde per dag.
    var main: Double? { summary.map { agg == "avg" ? $0.avg : $0.total } }
}

struct InsEvent: Identifiable, Hashable {
    let id = UUID()
    let kind: String
    let name: String
    let from: Date
    let to: Date?

    var isMaintenance: Bool { kind == "maintenance" }
    var title: String { "\(isMaintenance ? "Onderhoud" : "Storing"): \(name.isEmpty ? "onbekend" : name)" }
}

struct InsightsData: Hashable {
    let metric: InsMetric
    let period: InsPeriod
    let offset: Int
    /// "5min", "hour", "day" of "week"
    let step: String
    let edges: [Date]
    let nowIndex: Int?
    let hasPrev: Bool
    let hasNext: Bool
    let series: [InsSeries]
    let events: [InsEvent]

    init?(_ j: JSON, metric: InsMetric, period: InsPeriod) {
        let edges = j["edges"].array.compactMap(\.date)
        guard edges.count >= 2 else { return nil }
        self.metric = metric
        self.period = period
        self.edges = edges
        offset = j["offset"].int ?? 0
        step = j["step"].text ?? "day"
        nowIndex = j["now_index"].int
        hasPrev = j["has_prev"].bool ?? false
        hasNext = j["has_next"].bool ?? false
        let n = edges.count - 1
        series = j["series"].array.map { s in
            let vals = s["values"].array.map { $0.isNull ? nil : $0.double }
            return InsSeries(key: s["key"].text ?? "?", label: s["label"].text ?? "", agg: s["agg"].text ?? "sum",
                             available: (s["available"].bool ?? false) && vals.count == n,
                             values: vals.count == n ? vals : Array(repeating: nil, count: n), summary: InsSummary(s["summary"]))
        }
        events = j["events"].array.compactMap { e in
            guard let from = e["from"].date else { return nil }
            return InsEvent(kind: e["kind"].text ?? "incident", name: e["name"].text ?? "", from: from, to: e["to"].date)
        }
    }

    var count: Int { edges.count - 1 }
    var from: Date { edges[0] }
    var to: Date { edges[edges.count - 1] }
    func start(_ i: Int) -> Date { edges[i] }
    func end(_ i: Int) -> Date { edges[i + 1] }
    func mid(_ i: Int) -> Date { edges[i].addingTimeInterval(edges[i + 1].timeIntervalSince(edges[i]) / 2) }

    /// Tijdvak waarin een moment valt.
    func index(of date: Date) -> Int? {
        guard date >= edges[0], date < edges[edges.count - 1] else { return nil }
        var lo = 0, hi = count - 1
        while lo < hi {
            let m = (lo + hi + 1) / 2
            if edges[m] <= date { lo = m } else { hi = m - 1 }
        }
        return lo
    }

    var resolution: String {
        ["5min": "per 5 minuten", "hour": "per uur", "day": "per dag", "week": "per week"][step] ?? ""
    }

    /// Alles leeg (of nul): "Geen gegevens in deze periode".
    func isEmpty(shown: [InsSeries]) -> Bool {
        shown.reduce(0) { $0 + ($1.summary?.total ?? 0) } == 0
    }

    func eventsIn(_ i: Int) -> [InsEvent] {
        let a = start(i), b = end(i)
        return events.filter { $0.from < b && ($0.to ?? Date()) > a }
    }
}

/// Opmaak in Nederlandse tijd (zoals insRangeText / insBucketText in admin.js).
enum InsFmt {
    static let nl = Fmt.nl
    static let tz = Fmt.amsterdam
    static let calendar: Calendar = {
        var c = Calendar(identifier: .iso8601)
        c.timeZone = tz
        c.locale = nl
        return c
    }()

    private static func style() -> Date.FormatStyle { Date.FormatStyle(locale: nl, timeZone: tz) }
    static func time(_ d: Date) -> String { d.formatted(style().hour(.twoDigits(amPM: .omitted)).minute()) }
    static func dayMon(_ d: Date) -> String { d.formatted(style().day().month(.abbreviated)) }
    static func dayMonYear(_ d: Date) -> String { d.formatted(style().day().month(.abbreviated).year()) }
    static func long(_ d: Date) -> String { d.formatted(style().weekday(.wide).day().month(.wide)) }
    static func longYear(_ d: Date) -> String { d.formatted(style().weekday(.wide).day().month(.wide).year()) }
    static func monthYear(_ d: Date) -> String { d.formatted(style().month(.wide).year()).capitalizedFirst }
    static func year(_ d: Date) -> String { d.formatted(style().year()) }
    static func weekday(_ d: Date) -> String { d.formatted(style().weekday(.abbreviated)) }
    static func month(_ d: Date) -> String { d.formatted(style().month(.abbreviated)) }

    static func num(_ v: Double?) -> String {
        guard let v else { return "—" }
        return v.formatted(.number.precision(.fractionLength(0...1)).locale(nl))
    }

    static func compact(_ v: Double) -> String {
        if abs(v) >= 1_000_000 { return (v / 1_000_000).formatted(.number.precision(.fractionLength(0...1)).locale(nl)) + "M" }
        if abs(v) >= 10_000 { return (v / 1000).formatted(.number.precision(.fractionLength(0...1)).locale(nl)) + "K" }
        return num(v)
    }

    /// "Deze week · 12 okt – 18 okt 2026", "Oktober 2026", "Laatste 24 uur".
    static func range(_ d: InsightsData) -> String {
        let a = d.from, b = d.to.addingTimeInterval(-1), cur = d.offset == 0
        let span = year(a) == year(b) ? "\(dayMon(a)) – \(dayMonYear(b))" : "\(dayMonYear(a)) – \(dayMonYear(b))"
        switch d.period {
        case .hour: return "\(cur ? "Dit uur · " : "")\(dayMon(a)), \(time(a))–\(time(d.to))"
        case .day: return cur ? "Vandaag · \(long(a))" : d.offset == -1 ? "Gisteren · \(long(a))" : longYear(a).capitalizedFirst
        case .week: return "\(cur ? "Deze week · " : d.offset == -1 ? "Vorige week · " : "")\(span)"
        case .month: return "\(cur ? "Deze maand · " : "")\(monthYear(a))"
        case .year: return "\(cur ? "Dit jaar · " : "")\(year(a))"
        case .h24: return cur ? "Laatste 24 uur" : "\(dayMon(a)) \(time(a)) – \(dayMon(d.to)) \(time(d.to))"
        case .d7, .d30: return "\(cur ? "Laatste \(d.period == .d7 ? 7 : 30) dagen · " : "")\(span)"
        }
    }

    /// Tijd van één tijdvak (tooltip).
    static func bucket(_ d: InsightsData, _ i: Int) -> String {
        let a = d.start(i), b = d.end(i)
        switch d.step {
        case "5min": return "\(time(a))–\(time(b))"
        case "hour": return "\(long(a)), \(time(a))–\(time(b))".capitalizedFirst
        case "day": return longYear(a).capitalizedFirst
        default:
            let w = calendar.component(.weekOfYear, from: a)
            return "Week \(w) · \(dayMon(a)) – \(dayMon(b.addingTimeInterval(-1)))"
        }
    }

    /// As-label bij een moment, naar de resolutie.
    static func axis(_ d: InsightsData, _ date: Date) -> String {
        switch d.step {
        case "5min": return time(date)
        case "hour": return d.count > 48 ? weekday(date) : time(date)
        case "day": return d.count <= 7 ? weekday(date) : dayMon(date)
        default: return month(date)
        }
    }
}

extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

/// Insights-gegevens ophalen met een korte cache (zoals insCache op het web): zelfde metric/periode/offset binnen een minuut
/// niet opnieuw. `clear()` bij Vernieuwen.
@MainActor
enum InsightsCache {
    private static var store: [String: (at: Date, data: InsightsData)] = [:]

    static func key(_ m: InsMetric, _ p: InsPeriod, _ offset: Int, _ events: Bool) -> String { "\(m.rawValue)|\(p.rawValue)|\(offset)|\(events)" }

    static func cached(_ m: InsMetric, _ p: InsPeriod, _ offset: Int, _ events: Bool) -> InsightsData? {
        guard let e = store[key(m, p, offset, events)], Date().timeIntervalSince(e.at) < 60 else { return nil }
        return e.data
    }

    static func load(_ session: Session, _ m: InsMetric, _ p: InsPeriod, offset: Int, events: Bool) async throws -> InsightsData {
        if let c = cached(m, p, offset, events) { return c }
        let j = try await session.call("insights", ["metric": m.rawValue, "period": p.rawValue, "offset": offset, "events": events])
        guard let d = InsightsData(j, metric: m, period: p) else { throw APIError(code: "server_error", status: 200, body: j) }
        store[key(m, p, offset, events)] = (Date(), d)
        return d
    }

    static func clear() { store.removeAll() }
}

/// CSV van de zichtbare reeksen (alleen tijdvak en aantallen; ; als scheidingsteken zoals Excel NL), voor ShareLink.
struct InsightsCSV: Transferable {
    let text: String
    let fileName: String

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .commaSeparatedText) { csv in Data(("\u{FEFF}" + csv.text).utf8) }
            .suggestedFileName { $0.fileName }
    }

    /// `sets`: per metric de gegevens en de verborgen series.
    static func make(_ sets: [(InsightsData, Set<String>)]) -> InsightsCSV? {
        guard let first = sets.first?.0 else { return nil }
        let iso = ISO8601DateFormatter()
        func q(_ s: String) -> String { "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }
        var cols: [(InsightsData, InsSeries)] = []
        for (d, off) in sets { for s in d.series where s.available && !off.contains(s.key) { cols.append((d, s)) } }
        var spans: [(Date, Date)] = []
        var seen = Set<String>()
        for (d, _) in sets {
            for i in 0..<d.count where seen.insert("\(d.start(i).timeIntervalSince1970)|\(d.end(i).timeIntervalSince1970)").inserted {
                spans.append((d.start(i), d.end(i)))
            }
        }
        spans.sort { $0.0 != $1.0 ? $0.0 < $1.0 : $0.1 < $1.1 }
        var lines = [(["begin", "einde"] + cols.map { "\($0.0.metric.name) - \($0.1.label)" }).map(q).joined(separator: ";")]
        for (a, b) in spans {
            let row = cols.map { d, s -> String in
                guard let i = d.edges.firstIndex(of: a), i < d.count, d.end(i) == b, let v = s.values[i] else { return "" }
                return InsFmt.num(v).replacingOccurrences(of: ".", with: "")
            }
            if row.allSatisfy(\.isEmpty) { continue }
            lines.append(([q(iso.string(from: a)), q(iso.string(from: b))] + row).joined(separator: ";"))
        }
        let day = ISO8601DateFormatter.string(from: first.from, timeZone: InsFmt.tz, formatOptions: [.withFullDate])
        return InsightsCSV(text: lines.joined(separator: "\r\n") + "\r\n", fileName: "bingr-insights-\(first.period.rawValue)-\(day).csv")
    }
}
