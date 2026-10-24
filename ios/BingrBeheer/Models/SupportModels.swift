import Foundation

/// Tellers van `support_counts` (ook `counts` in `support_list`).
struct SupportCounts: Equatable {
    let new, open, pending, resolved, closed, active, unread, total, last7d: Int
    let smtp: Bool?

    init(_ j: JSON) {
        new = j["new"].int ?? 0
        open = j["open"].int ?? 0
        pending = j["pending"].int ?? 0
        resolved = j["resolved"].int ?? 0
        closed = j["closed"].int ?? 0
        active = j["active"].int ?? 0
        unread = j["unread"].int ?? 0
        total = j["total"].int ?? 0
        last7d = j["last_7d"].int ?? 0
        smtp = j["smtp"].bool
    }

    func count(for filter: String) -> Int? {
        switch filter {
        case "active": return active
        case "new": return new
        case "open": return open
        case "pending": return pending
        case "resolved": return resolved
        case "closed": return closed
        case "all": return total
        default: return nil
        }
    }

    /// Ondertitel van de tegel "Open tickets".
    var hint: String {
        unread > 0 ? "\(Fmt.num(unread)) wacht\(unread == 1 ? "" : "en") op reactie" : "\(Fmt.num(last7d)) nieuw in 7 dagen"
    }
}

/// Rij uit `support_list`.
struct TicketRow: Identifiable, Hashable {
    var id: Int { number }
    let number: Int
    let subject: String
    let email: String
    let name: String?
    let status: String
    let priority: String
    let category: String
    let platform: String?
    let createdAt: Date?
    let lastReplyAt: Date?
    let hasAccount: Bool
    let unread: Bool
    /// build 146: `app` voor een ticket uit de Support-tab van de app
    let source: String?

    init(_ j: JSON) {
        number = j["number"].int ?? 0
        subject = j["subject"].text ?? ""
        email = j["email"].text ?? ""
        name = j["name"].text
        status = j["status"].text ?? "new"
        priority = j["priority"].text ?? "normal"
        category = j["category"].text ?? "overig"
        platform = j["platform"].text
        createdAt = j["created_at"].date
        lastReplyAt = j["last_reply_at"].date
        hasAccount = j["has_account"].bool ?? false
        unread = j["unread"].bool ?? false
        source = j["source"].text
    }
}

/// Antwoord van `support_get`.
struct TicketDetail {
    struct Message: Identifiable {
        let id: Int
        /// customer | support | note | event
        let author: String
        let body: String
        let createdAt: Date?
        let emailSent: Bool?
        let emailError: String?
        let source: String?
        /// build 146: diagnose-bijlage (alleen in het beheer volledig)
        let diagnostics: TicketDiagnostics?
    }

    struct Account {
        let linked: Bool
        let deviceCount: Int
        let platforms: [String]
        let appVersions: [String]
        let createdAt: Date?
        let lastSeenAt: Date?
        let confirmed: Bool
        let tickets: Int
    }

    let number: Int
    let subject: String
    let email: String
    let name: String?
    let status: String
    let priority: String
    let category: String
    let platform: String?
    let appVersion: String?
    let deviceName: String?
    let osVersion: String?
    /// build 146: soort (phone, tablet, tv, desktop, browser) en model uit de diagnose-bijlage; `app` = via de app
    let deviceType: String?
    let deviceModel: String?
    let source: String?
    let lang: String
    let customerURL: URL?
    let createdAt: Date?
    let messages: [Message]
    let account: Account?
    let smtp: Bool?

    init(_ j: JSON) {
        let t = j["ticket"]
        number = t["number"].int ?? 0
        subject = t["subject"].text ?? ""
        email = t["email"].text ?? ""
        name = t["name"].text
        status = t["status"].text ?? "new"
        priority = t["priority"].text ?? "normal"
        category = t["category"].text ?? "overig"
        platform = t["platform"].text
        appVersion = t["app_version"].text
        deviceName = t["device_name"].text
        osVersion = t["os_version"].text
        deviceType = t["device_type"].text
        deviceModel = t["device_model"].text
        source = t["source"].text
        lang = t["lang"].text ?? "nl"
        customerURL = t["customer_url"].text.flatMap(URL.init(string:))
        createdAt = t["created_at"].date
        messages = j["messages"].array.enumerated().map { i, m in
            Message(id: i, author: m["author"].text ?? "", body: m["body"].string ?? "", createdAt: m["created_at"].date,
                    emailSent: m["email_sent"].bool, emailError: m["email_error"].text, source: m["source"].text,
                    diagnostics: TicketDiagnostics(m["diagnostics"]))
        }
        let a = j["account"]
        account = a.object == nil ? nil : Account(
            linked: a["linked"].bool ?? false, deviceCount: a["device_count"].int ?? 0, platforms: a["platforms"].strings,
            appVersions: a["app_versions"].strings, createdAt: a["created_at"].date, lastSeenAt: a["last_seen_at"].date,
            confirmed: a["confirmed"].bool ?? true, tickets: a["tickets"].int ?? 0)
        smtp = j["smtp"].bool
    }

    /// Apparaat in één regel: soort, model, systeem, naam (zoals het web-dashboard).
    var deviceLine: String? {
        let s = [deviceType.map(Labels.deviceType), deviceModel, osVersion, deviceName].compactMap { $0 }.joined(separator: " · ")
        return s.isEmpty ? nil : s
    }
}

/// Diagnose-bijlage bij een bericht uit de app (schema 1, docs/ACCOUNT.md "Build 146" in iptv-ios-appletv). Alle velden
/// optioneel: de server heeft de bijlage al opgeschoond; hier alleen lezen en netjes tonen.
struct TicketDiagnostics {
    struct Milestone: Identifiable { let id: Int; let name: String; let ms: Int?; let ok: Bool? }

    let kind: String
    let createdAt: Date?
    let platform: String?, version: String?, build: Int?, engine: String?
    let deviceType: String?, model: String?, manufacturer: String?, os: String?, osVersion: String?, language: String?, browser: String?, screen: String?
    let milestones: [Milestone]
    let memUsedMB: Double?, memTotalMB: Double?, memAppMB: Double?, lowMemory: Bool?
    let crashAt: Date?, crashType: String?, crashReason: String?, crashStack: [String], crashBuild: Int?, hasCrash: Bool
    let signedIn: Bool?, profiles: Int?, servers: Int?, serverKinds: [String], lastSync: Date?, lastSyncOk: Bool?, plan: String?, pushEnabled: Bool?
    let channels: Int?, movies: Int?, series: Int?, uptimeS: Int?
    let online: Bool?, netType: String?, backend: String?, backendMs: Int?, provider: String?, providerMs: Int?, vpn: Bool?
    let storageUsedMB: Double?, storageFreeMB: Double?, cacheMB: Double?, dbMB: Double?

    init?(_ j: JSON) {
        guard j.object != nil, let kind = j["kind"].text else { return nil }
        self.kind = kind
        createdAt = j["createdAt"].date
        let a = j["app"], d = j["device"], m = j["memory"], c = j["crash"], s = j["state"], n = s["network"], st = s["storage"]
        platform = a["platform"].text; version = a["version"].text; build = a["build"].int; engine = a["engine"].text
        deviceType = d["type"].text; model = d["model"].text; manufacturer = d["manufacturer"].text; os = d["os"].text
        osVersion = d["osVersion"].text; language = d["language"].text; browser = d["browser"].text; screen = d["screen"].text
        milestones = j["milestones"].array.enumerated().compactMap { i, x in
            x["name"].text.map { Milestone(id: i, name: $0, ms: x["ms"].int, ok: x["ok"].bool) }
        }
        memUsedMB = m["usedMB"].double; memTotalMB = m["totalMB"].double; memAppMB = m["appMB"].double; lowMemory = m["lowMemory"].bool
        hasCrash = c.object != nil
        crashAt = c["at"].date; crashType = c["type"].text; crashReason = c["reason"].text; crashStack = c["stack"].strings; crashBuild = c["build"].int
        signedIn = s["signedIn"].bool; profiles = s["profiles"].int; servers = s["servers"].int; serverKinds = s["serverKinds"].strings
        lastSync = s["lastSync"].date; lastSyncOk = s["lastSyncOk"].bool; plan = s["plan"].text; pushEnabled = s["pushEnabled"].bool
        channels = s["channels"].int; movies = s["movies"].int; series = s["series"].int; uptimeS = s["uptimeS"].int
        online = n["online"].bool; netType = n["type"].text; backend = n["backend"].text; backendMs = n["backendMs"].int
        provider = n["provider"].text; providerMs = n["providerMs"].int; vpn = n["vpn"].bool
        storageUsedMB = st["usedMB"].double; storageFreeMB = st["freeMB"].double; cacheMB = st["cacheMB"].double; dbMB = st["dbMB"].double
    }

    var kindLabel: String { kind == "start" ? "Startdiagnose" : kind == "app" ? "App-diagnose" : kind }
    var appLine: String? {
        let p = platform.map(Labels.diagPlatform)
        let v = version.map { "Bingr \($0)" + (build.map { " (\($0))" } ?? "") }
        let s = [p, v].compactMap { $0 }.joined(separator: " · ")
        return s.isEmpty ? nil : s
    }
    var systemLine: String? { let s = [os, osVersion].compactMap { $0 }.joined(separator: " "); return s.isEmpty ? nil : s }
    /// Samenvatting voor de kop: soort, model, systeem, app.
    var summary: String {
        [kindLabel, model ?? deviceType.map(Labels.deviceType), systemLine, appLine].compactMap { $0 }.joined(separator: " · ")
    }
}

/// Antwoord van `support_inbox` (inbox-import van support@).
struct InboxStatus {
    struct LogItem: Identifiable {
        let id: Int
        let at: Date?
        let sender: String?
        let subject: String?
        let result: String
        let ticketNumber: Int?
        let detail: String?
    }

    let configured: Bool
    let user: String?
    let extraAgents: Bool
    let lastPollAt: Date?
    let lastOkAt: Date?
    let lastImportAt: Date?
    let lastError: String?
    let lastErrorAt: Date?
    let lastFetched: Int
    let more: Bool
    let log: [LogItem]

    init(_ j: JSON) {
        configured = j["configured"].bool ?? false
        user = j["user"].text
        extraAgents = j["extra_agents"].bool ?? false
        let s = j["state"]
        lastPollAt = s["last_poll_at"].date
        lastOkAt = s["last_ok_at"].date
        lastImportAt = s["last_import_at"].date
        lastError = s["last_error"].text
        lastErrorAt = s["last_error_at"].date
        lastFetched = s["last_result"]["fetched"].int ?? 0
        more = s["last_result"]["more"].bool ?? false
        log = j["log"].array.enumerated().map { i, x in
            LogItem(id: i, at: x["at"].date, sender: x["sender"].text, subject: x["subject"].text,
                    result: x["result"].text ?? "", ticketNumber: x["ticket_number"].int, detail: x["detail"].text)
        }
    }

    /// Laatste ronde mislukt (fout na de laatste geslaagde ronde).
    var failed: Bool {
        guard lastError != nil else { return false }
        guard let ok = lastOkAt else { return true }
        return (lastErrorAt ?? .distantPast) >= ok
    }

    /// Planning (elke 2 min) lijkt niet te lopen.
    var stale: Bool {
        guard let p = lastPollAt else { return true }
        return Date().timeIntervalSince(p) > 600
    }
}
