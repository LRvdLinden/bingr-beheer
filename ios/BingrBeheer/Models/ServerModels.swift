import Foundation

// Kijkt nu (actie streams_now), Landen (actie countries) en de tab Server (actie server) van de functie admin
// (supabase/functions/admin/streams.ts en server.ts). Zelfde gegevens als het web-dashboard.

/// Eén stream die nu loopt (ping in de laatste 90 s). E-mail gemaskeerd door de functie.
struct LiveStream: Identifiable, Hashable {
    let id = UUID()
    let userID: String
    let email: String
    let name: String?
    let plan: String
    let country: String?
    let deviceName: String?
    let platform: String?
    let platformGroup: String
    let appVersion: String?
    let profileName: String?
    let title: String?
    let seriesTitle: String?
    let kind: String?
    let startedAt: Date?
    let lastPing: Date?

    init(_ j: JSON) {
        userID = j["user_id"].text ?? ""
        email = j["email"].text ?? ""
        name = j["name"].text
        plan = j["plan"].text ?? "free"
        country = j["country"].text
        deviceName = j["device_name"].text
        platform = j["platform"].text
        platformGroup = j["platform_group"].text ?? "other"
        appVersion = j["app_version"].text
        profileName = j["profile_name"].text
        title = j["title"].text
        seriesTitle = j["series_title"].text
        kind = j["kind"].text
        startedAt = j["started_at"].date
        lastPing = j["last_ping"].date
    }

    /// Titel; bij een aflevering met de serie ervoor als die er nog niet in staat.
    var what: String {
        let t = title ?? "", s = seriesTitle ?? ""
        if kind == "episode", !s.isEmpty, !t.lowercased().hasPrefix(s.lowercased()) { return t.isEmpty ? s : "\(s) · \(t)" }
        return t.isEmpty ? (s.isEmpty ? "Onbekende titel" : s) : t
    }

    var kindName: String? { kind.flatMap { ["live": "Live", "movie": "Film", "episode": "Aflevering"][$0] } }

    /// Platform voor naam en icoon: de groep van de server, of het ruwe platform als die onbekend is.
    var platformKey: String { platformGroup == "other" ? (platform ?? "") : platformGroup }
}

struct LiveStreams {
    let total: Int
    let accounts: Int
    let byKind: [String: Int]
    let items: [LiveStream]

    init(_ j: JSON) {
        total = j["total"].int ?? 0
        accounts = j["accounts"].int ?? 0
        var k: [String: Int] = [:]
        for (key, v) in j["by_kind"].object ?? [:] { k[key] = v.int ?? 0 }
        byKind = k
        items = j["items"].array.map(LiveStream.init)
    }
}

/// Verdeling per land (laatst gezien land per account).
struct CountryStats: Equatable {
    struct Item: Identifiable, Equatable {
        var id: String { country }
        let country: String
        let accounts: Int
        let active30d: Int
    }

    let accounts: Int
    let known: Int
    let items: [Item]

    init(_ j: JSON) {
        accounts = j["accounts"].int ?? 0
        known = j["known"].int ?? 0
        items = j["items"].array.compactMap { x in
            guard let c = x["country"].text, c.count == 2 else { return nil }
            return Item(country: c, accounts: x["accounts"].int ?? 0, active30d: x["active_30d"].int ?? 0)
        }
    }

    var unknown: Int { max(0, accounts - known) }
}

// MARK: tab Server

enum ServerPeriod: String, CaseIterable, Identifiable {
    case d7 = "7d", d30 = "30d", d90 = "90d", y1 = "1y"
    var id: String { rawValue }
    var tab: String { ["7d": "7 dagen", "30d": "30 dagen", "90d": "90 dagen", "1y": "1 jaar"][rawValue] ?? rawValue }
    var previous: String { ["7d": "7 dagen ervoor", "30d": "30 dagen ervoor", "90d": "90 dagen ervoor", "1y": "52 weken ervoor"][rawValue] ?? "" }
}

/// Bronnen in vaste volgorde (zelfde sleutels als SOURCES in server.ts).
enum ServerSource: String, CaseIterable, Identifiable {
    case database, storage, rows
    case accountsTotal = "accounts_total"
    case accounts, devices, streams, auth, proxy
    case proxyBytes = "proxy_bytes"
    case push, mail
    case fnCalls = "fn_calls", fnErrors = "fn_errors", fnMs = "fn_ms"

    var id: String { rawValue }

    var name: String {
        switch self {
        case .database: return "Database"
        case .storage: return "Opslag"
        case .rows: return "Rijen"
        case .accountsTotal: return "Accounts"
        case .accounts: return "Nieuw en actief"
        case .devices: return "Apparaten per platform"
        case .streams: return "Streams"
        case .auth: return "Inloggen"
        case .proxy: return "Webproxy: verzoeken"
        case .proxyBytes: return "Webproxy: verkeer"
        case .push: return "Push-afleveringen"
        case .mail: return "Mail"
        case .fnCalls: return "Functies: aanroepen"
        case .fnErrors: return "Functies: fouten"
        case .fnMs: return "Functies: duur"
        }
    }

    /// Staven voor aantallen per dag, anders een lijn.
    var bars: Bool { [.accounts, .push, .mail, .auth, .proxy, .proxyBytes, .fnCalls, .fnErrors].contains(self) }
}

struct ServerSeries: Identifiable, Hashable {
    var id: String { key }
    let key: String
    let label: String
    let agg: String
    let available: Bool
    let values: [Double?]
    let total: Double?
    let changePct: Double?
    let bytes: Bool
    let ms: Bool
    let down: Bool

    func format(_ v: Double?) -> String {
        guard let v else { return "—" }
        if bytes { return Fmt.bytes(v) }
        if ms { return "\(Fmt.num(Int(v.rounded()))) ms" }
        return v == v.rounded() ? Fmt.num(Int(v)) : String(format: "%.1f", v).replacingOccurrences(of: ".", with: ",")
    }
}

struct ServerData {
    struct Source { let desc: String; let series: [ServerSeries] }
    let period: ServerPeriod
    let step: String
    let edges: [Date]
    let hasPrev: Bool
    let hasNext: Bool
    let sources: [String: Source]
    let now: ServerNow?

    init?(_ j: JSON, period: ServerPeriod) {
        let edges = j["edges"].array.compactMap(\.date)
        guard edges.count >= 2 else { return nil }
        self.period = period
        self.edges = edges
        step = j["step"].text ?? "day"
        hasPrev = j["has_prev"].bool ?? false
        hasNext = j["has_next"].bool ?? false
        let n = edges.count - 1
        var out: [String: Source] = [:]
        for (key, src) in j["sources"].object ?? [:] {
            let series = src["series"].array.map { s -> ServerSeries in
                let vals = s["values"].array.map { $0.isNull ? nil : $0.double }
                return ServerSeries(key: s["key"].text ?? "?", label: s["label"].text ?? "", agg: s["agg"].text ?? "sum",
                                    available: (s["available"].bool ?? false) && vals.count == n,
                                    values: vals.count == n ? vals : Array(repeating: nil, count: n),
                                    total: s["summary"]["total"].double, changePct: s["summary"]["change_pct"].double,
                                    bytes: s["bytes"].bool ?? false, ms: s["ms"].bool ?? false, down: s["down"].bool ?? false)
            }
            out[key] = Source(desc: src["desc"].text ?? "", series: series)
        }
        sources = out
        now = j["now"].object != nil ? ServerNow(j["now"]) : nil
    }
}

/// Actuele stand (bingr_admin_server_now via nowView in server.ts).
struct ServerNow {
    struct Table: Identifiable { let id = UUID(); let name: String; let bytes: Double; let rows: Int? }
    struct Device: Identifiable { let id = UUID(); let platform: String; let devices: Int; let active30d: Int; let live: Int }
    struct Bucket: Identifiable { let id = UUID(); let bucket: String; let isPublic: Bool; let objects: Int; let bytes: Double }
    struct Job: Identifiable { let id = UUID(); let name: String; let schedule: String; let active: Bool; let lastStart: Date?; let lastStatus: String?; let runs24h: Int; let failed24h: Int }

    let dbBytes: Double
    let connections: Int
    let today: JSON
    let counts: JSON
    let tables: [Table]
    let devices: [Device]
    let storage: [Bucket]
    let cron: [Job]
    let queues: JSON
    let proxy30d: JSON
    let peakHours: [(hour: Int, value: Int)]
    let firstDay: String?

    init(_ j: JSON) {
        dbBytes = j["db"]["bytes"].double ?? 0
        connections = j["db"]["connections"].int ?? 0
        today = j["today"]
        counts = j["counts"]
        queues = j["queues"]
        proxy30d = j["proxy_30d"]
        firstDay = j["first_day"].text
        tables = j["tables"].array.map { Table(name: $0["name"].text ?? "?", bytes: $0["bytes"].double ?? 0, rows: $0["rows"].int) }
        devices = j["devices"].array.map { Device(platform: $0["platform"].text ?? "other", devices: $0["devices"].int ?? 0, active30d: $0["active_30d"].int ?? 0, live: $0["live"].int ?? 0) }
        storage = j["storage"].array.map { Bucket(bucket: $0["bucket"].text ?? "?", isPublic: $0["public"].bool ?? false, objects: $0["objects"].int ?? 0, bytes: $0["bytes"].double ?? 0) }
        cron = j["cron"].array.map {
            Job(name: $0["name"].text ?? "?", schedule: $0["schedule"].text ?? "", active: $0["active"].bool ?? false, lastStart: $0["last_start"].date,
                lastStatus: $0["last_status"].text, runs24h: $0["runs_24h"].int ?? 0, failed24h: $0["failed_24h"].int ?? 0)
        }
        let ph = j["today"]["peak_h"].object ?? [:]
        peakHours = (0..<24).map { h in (h, ph[String(h)]?.int ?? 0) }
    }
}
