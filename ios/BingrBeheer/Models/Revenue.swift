import Foundation
import SwiftUI

// Omzet (tab Omzet): Lifetime-aankopen via Stripe per periode uit de actie `revenue` van de functie admin
// (supabase/functions/admin/revenue.ts). Bedragen in centen; alleen aantallen en bedragen, geen gegevens per persoon.
// Zelfde periodes, resoluties, series en kleuren als de tab Omzet in web/admin.js.

enum RevPeriod: String, CaseIterable, Identifiable, Codable {
    case day, week, month, year
    case d7 = "7d", d30 = "30d"

    var id: String { rawValue }

    var tab: String {
        switch self {
        case .day: return "Dag"
        case .week: return "Week"
        case .month: return "Maand"
        case .year: return "Jaar"
        case .d7: return "7 dagen"
        case .d30: return "30 dagen"
        }
    }

    var previous: String {
        switch self {
        case .day: return "gisteren"
        case .week: return "vorige week"
        case .month: return "vorige maand"
        case .year: return "vorig jaar"
        case .d7: return "7 dagen ervoor"
        case .d30: return "30 dagen ervoor"
        }
    }

    /// Toegestane resoluties (de eerste = automatisch), zoals BUCKETS in revenue.ts.
    var buckets: [String] {
        switch self {
        case .day: return ["hour"]
        case .week, .d7: return ["day", "hour"]
        case .month, .d30: return ["day"]
        case .year: return ["month", "week"]
        }
    }
}

enum RevMode: String, CaseIterable, Identifiable, Codable {
    case auto = "", live, test, all
    var id: String { rawValue }
    var title: String {
        switch self {
        case .auto: return "Volgens Stripe-sleutel"
        case .live: return "Live"
        case .test: return "Test"
        case .all: return "Live en test"
        }
    }
}

struct RevSeries: Identifiable, Hashable {
    var id: String { key }
    let key: String
    let label: String
    let money: Bool
    let down: Bool
    let available: Bool
    let values: [Double?]
    let summary: InsSummary?

    func format(_ v: Double?) -> String {
        guard let v else { return "—" }
        return money ? Fmt.euro(Int(v.rounded())) : InsFmt.num(v)
    }
}

struct RevTotals: Hashable {
    let count, gross, vat, net, fees, refunds, refundsNet, proceeds, refundCount, disputeCount, missingFees: Int

    init(_ j: JSON) {
        count = j["count"].int ?? 0
        gross = j["gross"].int ?? 0
        vat = j["vat"].int ?? 0
        net = j["net"].int ?? 0
        fees = j["fees"].int ?? 0
        refunds = j["refunds"].int ?? 0
        refundsNet = j["refunds_net"].int ?? 0
        proceeds = j["proceeds"].int ?? 0
        refundCount = j["refund_count"].int ?? 0
        disputeCount = j["dispute_count"].int ?? 0
        missingFees = j["missing_fees"].int ?? 0
    }
}

struct RevShare: Identifiable, Hashable {
    var id: String { key }
    let key: String
    let label: String
    let count: Int
    let gross: Int
}

struct RevenueData: Hashable {
    let period: RevPeriod
    let offset: Int
    /// "hour", "day", "week" of "month"
    let step: String
    let edges: [Date]
    let nowIndex: Int?
    let hasPrev: Bool
    let hasNext: Bool
    let series: [RevSeries]
    let totals: [String: RevTotals]
    let byMethod: [RevShare]
    let byCountry: [RevShare]
    let vatText: String
    let vatNote: String
    let vatSource: String
    let vatRate: Double
    let billingEnabled: Bool
    let billingMode: String?
    let mode: String
    let liveCount: Int
    let testCount: Int
    let empty: Bool

    init?(_ j: JSON, period: RevPeriod) {
        let edges = j["edges"].array.compactMap(\.date)
        guard edges.count >= 2, j["totals"].object != nil else { return nil }
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
            return RevSeries(key: s["key"].text ?? "?", label: s["label"].text ?? "", money: s["money"].bool ?? false, down: s["down"].bool ?? false,
                             available: (s["available"].bool ?? false) && vals.count == n,
                             values: vals.count == n ? vals : Array(repeating: nil, count: n), summary: InsSummary(s["summary"]))
        }
        var t: [String: RevTotals] = [:]
        for (k, v) in j["totals"].object ?? [:] { t[k] = RevTotals(v) }
        totals = t
        let share: (JSON) -> RevShare? = { r in
            guard let k = r["key"].text else { return nil }
            return RevShare(key: k, label: r["label"].text ?? k, count: r["count"].int ?? 0, gross: r["gross"].int ?? 0)
        }
        byMethod = j["by_method"].array.compactMap(share)
        byCountry = j["by_country"].array.compactMap(share)
        vatText = j["vat"]["text"].text ?? ""
        vatNote = j["vat"]["note"].text ?? ""
        vatSource = j["vat"]["source"].text ?? "fixed"
        vatRate = j["vat"]["rate"].double ?? 21
        billingEnabled = j["billing"]["enabled"].bool ?? false
        billingMode = j["billing"]["mode"].text
        mode = j["mode"].text ?? "all"
        liveCount = j["live_count"].int ?? 0
        testCount = j["test_count"].int ?? 0
        empty = j["empty"].bool ?? true
    }

    var count: Int { edges.count - 1 }
    var from: Date { edges[0] }
    var to: Date { edges[edges.count - 1] }
    func start(_ i: Int) -> Date { edges[i] }
    func end(_ i: Int) -> Date { edges[i + 1] }
    func mid(_ i: Int) -> Date { edges[i].addingTimeInterval(edges[i + 1].timeIntervalSince(edges[i]) / 2) }
    func total(_ k: String) -> RevTotals? { totals[k] }
    func series(_ keys: [String]) -> [RevSeries] { keys.compactMap { k in series.first { $0.key == k } } }

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
        ["hour": "per uur", "day": "per dag", "week": "per week", "month": "per maand"][step] ?? ""
    }

    /// "Deze maand · Oktober 2026", "Dit jaar · 2026", "Deze week · 12 okt – 18 okt 2026".
    var rangeText: String {
        let a = from, b = to.addingTimeInterval(-1), cur = offset == 0
        let span = InsFmt.year(a) == InsFmt.year(b) ? "\(InsFmt.dayMon(a)) – \(InsFmt.dayMonYear(b))" : "\(InsFmt.dayMonYear(a)) – \(InsFmt.dayMonYear(b))"
        switch period {
        case .day: return cur ? "Vandaag · \(InsFmt.long(a))" : offset == -1 ? "Gisteren · \(InsFmt.long(a))" : InsFmt.longYear(a).capitalizedFirst
        case .week: return "\(cur ? "Deze week · " : offset == -1 ? "Vorige week · " : "")\(span)"
        case .month: return "\(cur ? "Deze maand · " : "")\(InsFmt.monthYear(a))"
        case .year: return "\(cur ? "Dit jaar · " : "")\(InsFmt.year(a))"
        case .d7, .d30: return "\(cur ? "Laatste \(period == .d7 ? 7 : 30) dagen · " : "")\(span)"
        }
    }

    func bucketText(_ i: Int) -> String {
        let a = start(i), b = end(i)
        switch step {
        case "hour": return "\(InsFmt.long(a)), \(InsFmt.time(a))–\(InsFmt.time(b))".capitalizedFirst
        case "day": return InsFmt.longYear(a).capitalizedFirst
        case "month": return InsFmt.monthYear(a)
        default:
            let w = InsFmt.calendar.component(.weekOfYear, from: a)
            return "Week \(w) · \(InsFmt.dayMon(a)) – \(InsFmt.dayMon(b.addingTimeInterval(-1)))"
        }
    }

    func axis(_ date: Date) -> String {
        switch step {
        case "hour": return count > 48 ? InsFmt.weekday(date) : InsFmt.time(date)
        case "day": return count <= 7 ? InsFmt.weekday(date) : InsFmt.dayMon(date)
        default: return InsFmt.month(date)
        }
    }
}

/// Bewaarde keuze van de tab Omzet (UserDefaults "revenuePage", zelfde velden als localStorage bingrAdmin.revenue).
struct RevenuePageState: Codable, Equatable {
    var period: RevPeriod = .month
    var bucket = "auto"
    var mode: RevMode = .auto
    var bars = false
    var offMoney: [String] = []
    var offCount: [String] = []

    static let key = "revenuePage"
    static func load() -> RevenuePageState {
        guard let data = UserDefaults.standard.string(forKey: key)?.data(using: .utf8),
              let s = try? JSONDecoder().decode(RevenuePageState.self, from: data) else { return RevenuePageState() }
        return s
    }
    func save() {
        if let d = try? JSONEncoder().encode(self), let t = String(data: d, encoding: .utf8) { UserDefaults.standard.set(t, forKey: Self.key) }
    }

    var params: [String: Any?] {
        var p: [String: Any?] = ["period": period.rawValue, "bucket": period.buckets.contains(bucket) ? bucket : "auto"]
        if mode != .auto { p["mode"] = mode.rawValue }
        return p
    }
}
