import Foundation

// Instelbaar dashboard (tab Overzicht). Zelfde JSON-model als het web-dashboard (web/admin.js, README.md "Dashboard"):
// {"version": 1, "widgets": [{"id", "type", "size", "hidden", "options"}]}. Volgorde = volgorde in de lijst.
// Opslag in UserDefaults (sleutel "dashboardLayout", JSON-tekst). Onbekend of kapot = standaardindeling.

/// Grootte in het raster: S = 1×1, M = 2×1, L = 2×2.
enum DashSize: String, Codable, CaseIterable, Identifiable {
    case s, m, l

    var id: String { rawValue }
    var name: String { ["s": "Klein", "m": "Middel", "l": "Groot"][rawValue] ?? rawValue }
    var dims: String { ["s": "1×1", "m": "2×1", "l": "2×2"][rawValue] ?? "" }
    var columns: Int { self == .s ? 1 : 2 }
    var rows: Int { self == .l ? 2 : 1 }
}

/// Plaats in het raster (kolommen × rijen). Insights-grafieken zijn hoger: M = 2×2, L = 2×3 (zoals op het web).
struct DashSpan: Equatable {
    var columns: Int
    var rows: Int
}

enum DashWidgetType: String, Codable, CaseIterable, Identifiable {
    case metric
    /// Grafiek zoals Homey Insights (actie insights). Vervangt "Per dag" (daily_chart): die wordt bij het lezen omgezet.
    case insights
    /// `announcements` (type-id blijft voor bewaarde indelingen) toont sinds build 14 de pushgeschiedenis (push_history).
    case platforms, versions, plans, support, status, announcements
    case pushSubscribers = "push_subscribers"
    /// Abonnees van de nieuwsbrief (newsletter_status: recipients.total) ten opzichte van alle leden (stats).
    case newsletter
    /// Uit welke landen de gebruikers komen (actie countries: laatst gezien land per account, alleen de landcode).
    case countries

    var id: String { rawValue }

    var name: String {
        switch self {
        case .metric: return "Kengetal"
        case .insights: return "Grafiek (Insights)"
        case .platforms: return "Apparaten per platform"
        case .versions: return "App-versies"
        case .plans: return "Abonnementen"
        case .support: return "Supporttickets"
        case .status: return "Servicestatus"
        case .announcements: return "Laatste pushmeldingen"
        case .pushSubscribers: return "Pushabonnees"
        case .newsletter: return "Nieuwsbrief"
        case .countries: return "Landen"
        }
    }

    var summary: String {
        switch self {
        case .metric: return "Eén getal: gebruikers, actief, apparaten, kijkers, abonnementen, geblokkeerd…"
        case .insights: return "Accounts, inlogs, streams, pushmeldingen of supporttickets door de tijd: kies uur, dag, week, maand of jaar en blader terug"
        case .platforms: return "Actieve apparaten per platform (30 dagen of nu)"
        case .versions: return "App-versies in gebruik per platform"
        case .plans: return "Gratis, Lifetime en accounts met eigen limieten"
        case .support: return "Tickets per status en wat op een reactie wacht"
        case .status: return "Totaalstatus, storingen en meldingen van de statusmonitor"
        case .announcements: return "De nieuwste pushmeldingen: beheer, releases en herinneringen"
        case .pushSubscribers: return "Accounts en apparaten met pushmeldingen aan, per platform"
        case .newsletter: return "Abonnees van de nieuwsbrief (bevestigd e-mailadres) ten opzichte van alle leden"
        case .countries: return "Uit welke landen de gebruikers komen: vlag, land en aantal accounts"
        }
    }

    var icon: String {
        switch self {
        case .metric: return "number"
        case .insights: return "chart.xyaxis.line"
        case .platforms: return "iphone.and.arrow.forward"
        case .versions: return "app.badge"
        case .plans: return "star"
        case .support: return "lifepreserver"
        case .status: return "waveform.path.ecg"
        case .announcements: return "bell.badge"
        case .pushSubscribers: return "person.2.wave.2"
        case .newsletter: return "envelope.badge"
        case .countries: return "globe.europe.africa"
        }
    }

    var sizes: [DashSize] {
        switch self {
        case .metric, .newsletter: return [.s, .m]
        case .insights, .plans, .support, .status, .pushSubscribers: return [.s, .m, .l]
        case .platforms, .versions, .announcements, .countries: return [.m, .l]
        }
    }

    var defaultSize: DashSize {
        switch self {
        case .metric, .support, .newsletter: return .s
        case .plans, .status, .pushSubscribers: return .m
        default: return .l
        }
    }
}

/// Getallen voor de widget Kengetal (velden van `stats`).
enum DashMetric: String, CaseIterable, Identifiable {
    case usersTotal = "users_total", usersNew7d = "users_new_7d", activeToday = "active_today", active30d = "active_30d"
    case devices, watchingNow = "watching_now", blocked, planFree = "plan_free", planLifetime = "plan_lifetime"
    case planCustom = "plan_custom", optedOut = "opted_out"
    case purchases = "purchases_paid", revenue = "revenue_cents"
    /// build 134: registratiebescherming (stats.signup_guard)
    case signupsRejected = "signups_rejected", unconfirmedDeleted = "unconfirmed_deleted"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .usersTotal: return "Gebruikers"
        case .usersNew7d: return "Nieuw (7 dagen)"
        case .activeToday: return "Actief vandaag"
        case .active30d: return "Actief (30 dagen)"
        case .devices: return "Apparaten"
        case .watchingNow: return "Kijkt nu"
        case .blocked: return "Geblokkeerd"
        case .planFree: return "Gratis"
        case .planLifetime: return "Lifetime"
        case .planCustom: return "Eigen limieten"
        case .optedOut: return "Geen berichtenmail"
        case .purchases: return "Aankopen"
        case .revenue: return "Omzet"
        case .signupsRejected: return "Registraties geweigerd (24 u)"
        case .unconfirmedDeleted: return "Onbevestigd verwijderd (7 d)"
        }
    }

    /// Filter van de tab Gebruikers bij een tik op de widget (nil = niet klikbaar).
    var usersFilter: String? {
        switch self {
        case .blocked: return "blocked"
        case .planFree: return "free"
        case .planLifetime: return "lifetime"
        case .planCustom: return "custom"
        default: return nil
        }
    }
}

/// Opties van een widget. Alleen de sleutels van het type worden bewaard (zie `normalized(for:)`); onbekende of
/// verkeerd getypte waarden vallen terug op de standaard.
struct DashOptions: Codable, Equatable {
    var metric: String?
    var series: String?
    var days: Int?
    var display: String?
    var source: String?
    var platforms: [String]?
    var plans: [String]?
    var statuses: [String]?
    var count: Int?
    var onlyActive: Bool?
    var showIncidents: Bool?
    var showNotices: Bool?
    var pushPlatforms: [String]?
    var showNew: Bool?
    var showLangs: Bool?
    // landen: actief in 30 dagen tonen
    var showActive: Bool?
    // insights: metric, periode, storingen tonen, verborgen series (legenda)
    var insight: String?
    var period: String?
    var events: Bool?
    var off: [String]?

    enum CodingKeys: String, CodingKey {
        case metric, series, days, display, source, platforms, plans, statuses, count
        case onlyActive = "only_active", showIncidents = "show_incidents", showNotices = "show_notices"
        case pushPlatforms = "push_platforms", showNew = "show_new", showLangs = "show_langs", showActive = "show_active"
        case insight, period, events, off
    }

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        metric = try? c.decodeIfPresent(String.self, forKey: .metric)
        series = try? c.decodeIfPresent(String.self, forKey: .series)
        days = try? c.decodeIfPresent(Int.self, forKey: .days)
        display = try? c.decodeIfPresent(String.self, forKey: .display)
        source = try? c.decodeIfPresent(String.self, forKey: .source)
        platforms = try? c.decodeIfPresent([String].self, forKey: .platforms)
        plans = try? c.decodeIfPresent([String].self, forKey: .plans)
        statuses = try? c.decodeIfPresent([String].self, forKey: .statuses)
        count = try? c.decodeIfPresent(Int.self, forKey: .count)
        onlyActive = try? c.decodeIfPresent(Bool.self, forKey: .onlyActive)
        showIncidents = try? c.decodeIfPresent(Bool.self, forKey: .showIncidents)
        showNotices = try? c.decodeIfPresent(Bool.self, forKey: .showNotices)
        pushPlatforms = try? c.decodeIfPresent([String].self, forKey: .pushPlatforms)
        showNew = try? c.decodeIfPresent(Bool.self, forKey: .showNew)
        showLangs = try? c.decodeIfPresent(Bool.self, forKey: .showLangs)
        showActive = try? c.decodeIfPresent(Bool.self, forKey: .showActive)
        insight = try? c.decodeIfPresent(String.self, forKey: .insight)
        period = try? c.decodeIfPresent(String.self, forKey: .period)
        events = try? c.decodeIfPresent(Bool.self, forKey: .events)
        off = try? c.decodeIfPresent([String].self, forKey: .off)
    }

    static let seriesValues = ["new_users", "signins", "active_users"]
    static let daysValues = [7, 14, 30]
    static let planValues = ["free", "lifetime", "custom"]
    static let statusValues = ["new", "open", "pending", "resolved", "closed"]
    static let countValues = [3, 5]
    static let pushPlatformValues = ["ios", "ipados", "macos", "android", "web"]

    private static func pick<T: Equatable>(_ v: T?, _ allowed: [T], _ def: T) -> T {
        if let v, allowed.contains(v) { return v }
        return def
    }

    /// Deelverzameling in vaste volgorde; leeg of ongeldig = standaard.
    private static func subset(_ v: [String]?, _ allowed: [String], _ def: [String]) -> [String] {
        let f = allowed.filter { (v ?? []).contains($0) }
        return f.isEmpty ? def : f
    }

    /// Vrije lijst (platforms): uniek, max. 30 teksten van max. 40 tekens; leeg = alles.
    private static func list(_ v: [String]?) -> [String] {
        var seen = Set<String>()
        return (v ?? []).filter { !$0.isEmpty && $0.count <= 40 && seen.insert($0).inserted }.prefix(30).map { $0 }
    }

    /// Geldige opties voor het type, met standaardwaarden; sleutels van andere types weg.
    func normalized(for type: DashWidgetType) -> DashOptions {
        var o = DashOptions()
        switch type {
        case .metric:
            o.metric = Self.pick(metric, DashMetric.allCases.map(\.rawValue), DashMetric.usersTotal.rawValue)
        case .insights:
            let m = InsMetric(rawValue: insight ?? "") ?? .accounts
            o.insight = m.rawValue
            o.period = Self.pick(period, InsPeriod.allCases.map(\.rawValue), InsPeriod.d30.rawValue)
            o.display = Self.pick(display, ["auto", "line", "bar", "number"], "auto")
            o.events = events ?? true
            o.off = m.series.filter { (off ?? []).contains($0) }
        case .platforms:
            o.source = Self.pick(source, ["30d", "live"], "30d")
            o.platforms = Self.list(platforms)
        case .versions:
            o.platforms = Self.list(platforms)
        case .plans:
            o.plans = Self.subset(plans, Self.planValues, Self.planValues)
        case .support:
            o.statuses = Self.subset(statuses, Self.statusValues, ["new", "open", "pending"])
            o.display = Self.pick(display, ["number", "list"], "number")
        case .status:
            o.showIncidents = showIncidents ?? true
            o.showNotices = showNotices ?? true
        case .announcements:
            o.count = Self.pick(count, Self.countValues, 3)
        case .pushSubscribers:
            o.pushPlatforms = Self.subset(pushPlatforms, Self.pushPlatformValues, Self.pushPlatformValues)
            o.showNew = showNew ?? true
        case .newsletter:
            o.showLangs = showLangs ?? true
        case .countries:
            o.showActive = showActive ?? true
        }
        return o
    }

    /// "Per dag" (daily_chart, tot build 16) als Insights-grafiek met dezelfde gegevens en periode (zoals migrateWidget in admin.js).
    static func fromDailyChart(_ old: DashOptions) -> DashOptions {
        var o = DashOptions()
        o.insight = old.series == "signins" ? "signins" : "accounts"
        o.period = old.days == 7 ? "7d" : "30d"
        o.display = old.display == "number" ? "number" : "auto"
        o.off = old.series == "active_users" ? ["new_users"] : old.series == "signins" ? [] : ["active_users"]
        return o
    }

    // gemak: waarden na normalized(for:)
    var metricValue: DashMetric { DashMetric(rawValue: metric ?? "") ?? .usersTotal }
    var seriesValue: String { series ?? "new_users" }
    var daysValue: Int { days ?? 30 }
    var platformList: [String] { platforms ?? [] }
    var planList: [String] { plans ?? Self.planValues }
    var statusList: [String] { statuses ?? ["new", "open", "pending"] }
    var pushPlatformList: [String] { pushPlatforms ?? Self.pushPlatformValues }
}

struct DashWidget: Codable, Equatable, Identifiable {
    var id: String
    var type: DashWidgetType
    var size: DashSize
    var hidden: Bool
    var options: DashOptions

    var span: DashSpan {
        let s = DashSpan(columns: size.columns, rows: size.rows)
        guard type == .insights, options.display != "number" else { return s }
        return size == .m ? DashSpan(columns: 2, rows: 2) : size == .l ? DashSpan(columns: 2, rows: 3) : s
    }

    enum CodingKeys: String, CodingKey { case id, type, size, hidden, options }

    init(id: String, type: DashWidgetType, size: DashSize? = nil, hidden: Bool = false, options: DashOptions = DashOptions()) {
        self.id = id
        self.type = type
        self.size = size.flatMap { type.sizes.contains($0) ? $0 : nil } ?? type.defaultSize
        self.hidden = hidden
        self.options = options.normalized(for: type)
    }

    /// Onbekend type = fout (de widget valt weg); de rest valt terug op standaardwaarden.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try c.decode(String.self, forKey: .type)
        var options = (try? c.decodeIfPresent(DashOptions.self, forKey: .options)) ?? DashOptions()
        let type: DashWidgetType
        if raw == "daily_chart" {
            type = .insights
            options = DashOptions.fromDailyChart(options)
        } else {
            guard let t = DashWidgetType(rawValue: raw) else {
                throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "onbekend type")
            }
            type = t
        }
        self.init(id: (try? c.decode(String.self, forKey: .id)) ?? "",
                  type: type,
                  size: try? c.decodeIfPresent(DashSize.self, forKey: .size),
                  hidden: (try? c.decodeIfPresent(Bool.self, forKey: .hidden)) ?? false,
                  options: options)
    }
}

struct DashLayout: Codable, Equatable {
    static let currentVersion = 1
    static let maxWidgets = 40

    var version: Int
    var widgets: [DashWidget]

    /// Slaat widgets over die niet te lezen zijn (bv. een onbekend type van een nieuwere versie).
    private struct Lossy: Decodable {
        let widget: DashWidget?
        init(from decoder: Decoder) throws { widget = try? DashWidget(from: decoder) }
    }

    enum CodingKeys: String, CodingKey { case version, widgets }

    init(version: Int = DashLayout.currentVersion, widgets: [DashWidget]) {
        self.version = version
        self.widgets = widgets
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decode(Int.self, forKey: .version)
        widgets = try c.decode([Lossy].self, forKey: .widgets).compactMap(\.widget)
    }

    var visible: [DashWidget] { widgets.filter { !$0.hidden } }

    /// Geldige indeling of nil: versie 1, unieke id's (ongeldig of dubbel = nieuw id), hoogstens 40, minstens één widget.
    func normalized() -> DashLayout? {
        guard version == Self.currentVersion else { return nil }
        var seen = Set<String>()
        var out: [DashWidget] = []
        for var w in widgets {
            if out.count >= Self.maxWidgets { break }
            if !Self.validID(w.id) || seen.contains(w.id) { w.id = Self.newID(for: w.type, seen: seen) }
            seen.insert(w.id)
            out.append(DashWidget(id: w.id, type: w.type, size: w.size, hidden: w.hidden, options: w.options))
        }
        return out.isEmpty ? nil : DashLayout(widgets: out)
    }

    static func validID(_ s: String) -> Bool {
        !s.isEmpty && s.count <= 40 && s.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
    }

    static func newID(for type: DashWidgetType, seen: Set<String>) -> String {
        var i = 1
        while seen.contains("\(type.rawValue)_\(i)") { i += 1 }
        return "\(type.rawValue)_\(i)"
    }

    /// Standaardindeling: lijkt op het vroegere vaste overzicht (zelfde als DASH_DEFAULT in web/admin.js).
    static var standard: DashLayout {
        func metric(_ id: String, _ m: DashMetric) -> DashWidget {
            var o = DashOptions()
            o.metric = m.rawValue
            return DashWidget(id: id, type: .metric, size: .s, options: o)
        }
        func chart(_ id: String, _ m: InsMetric, _ p: InsPeriod) -> DashWidget {
            var o = DashOptions()
            o.insight = m.rawValue
            o.period = p.rawValue
            return DashWidget(id: id, type: .insights, size: .l, options: o)
        }
        return DashLayout(widgets: [
            metric("users", .usersTotal), metric("new_7d", .usersNew7d), metric("active_today", .activeToday),
            metric("active_30d", .active30d), metric("devices", .devices), metric("watching", .watchingNow),
            DashWidget(id: "support", type: .support, size: .s), metric("blocked", .blocked),
            metric("plan_free", .planFree), metric("plan_lifetime", .planLifetime),
            metric("signups_rejected", .signupsRejected), metric("unconfirmed_deleted", .unconfirmedDeleted),
            DashWidget(id: "status", type: .status, size: .m),
            chart("chart_new", .accounts, .d30), chart("chart_streams", .streams, .d7), chart("chart_push", .push, .d30),
            DashWidget(id: "platforms", type: .platforms, size: .l), DashWidget(id: "versions", type: .versions, size: .l),
            DashWidget(id: "countries", type: .countries, size: .l),
        ])
    }
}

/// Opslag in UserDefaults als JSON-tekst (zelfde tekst als localStorage "bingrAdmin.dashboard" op het web).
enum DashStore {
    static let key = "dashboardLayout"

    static func decode(_ text: String?) -> DashLayout? {
        guard let data = text?.data(using: .utf8), let l = try? JSONDecoder().decode(DashLayout.self, from: data) else { return nil }
        return l.normalized()
    }

    static func load() -> DashLayout {
        decode(UserDefaults.standard.string(forKey: key)) ?? .standard
    }

    static func save(_ layout: DashLayout) {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        if let data = try? enc.encode(layout), let text = String(data: data, encoding: .utf8) {
            UserDefaults.standard.set(text, forKey: key)
        }
    }
}
