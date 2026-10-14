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
        lang = t["lang"].text ?? "nl"
        customerURL = t["customer_url"].text.flatMap(URL.init(string:))
        createdAt = t["created_at"].date
        messages = j["messages"].array.enumerated().map { i, m in
            Message(id: i, author: m["author"].text ?? "", body: m["body"].string ?? "", createdAt: m["created_at"].date,
                    emailSent: m["email_sent"].bool, emailError: m["email_error"].text, source: m["source"].text)
        }
        let a = j["account"]
        account = a.object == nil ? nil : Account(
            linked: a["linked"].bool ?? false, deviceCount: a["device_count"].int ?? 0, platforms: a["platforms"].strings,
            appVersions: a["app_versions"].strings, createdAt: a["created_at"].date, lastSeenAt: a["last_seen_at"].date,
            confirmed: a["confirmed"].bool ?? true, tickets: a["tickets"].int ?? 0)
        smtp = j["smtp"].bool
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
