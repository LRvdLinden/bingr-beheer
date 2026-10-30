import SwiftUI

/// Antwoord van `status` met op `overview` (de functie `status`, actie `admin`).
struct StatusOverview {
    struct Group: Identifiable {
        let id: String
        let name: String
        let monitors: [Monitor]
    }

    struct Incident: Identifiable {
        let id: String
        let monitorID: String
        let name: String
        let startedAt: Date?
        let endedAt: Date?
        let durationS: Int?
        let cause: String?
    }

    struct DeviceCount: Identifiable {
        var id: String { platform }
        let platform: String
        let devices: Int
    }

    let generatedAt: Date?
    let overallState: String
    let down: [String]
    let degraded: [String]
    let groups: [Group]
    let incidents: [Incident]
    let devices: [DeviceCount]
    // planning
    let cronExists: Bool
    let cronActive: Bool
    let cronSchedule: String?
    let cronLastStatus: String?
    let cronLastStart: Date?
    let lastRunAt: Date?
    let lastSource: String?
    // alerts
    let alertEmail: String?
    let alertSMTP: Bool
    let intervals: [Int]
    // meldingen: storingen en gepland onderhoud (all_notices, alleen voor het beheer)
    let notices: [StatusNotice]
    let subscribersConfirmed: Int?

    init(_ j: JSON) {
        generatedAt = j["generated_at"].date
        overallState = j["overall"]["state"].text ?? "up"
        down = j["overall"]["down"].strings
        degraded = j["overall"]["degraded"].strings
        groups = j["groups"].array.map { g in
            let id = g["id"].text ?? ""
            return Group(id: id, name: g["name"]["nl"].text ?? Labels.groups.first(where: { $0.key == id })?.label ?? id,
                         monitors: g["monitors"].array.map { Monitor($0, group: id) })
        }
        incidents = j["incidents"].array.map {
            Incident(id: $0["id"].text ?? UUID().uuidString, monitorID: $0["monitor_id"].text ?? "",
                     name: $0["name"]["nl"].text ?? $0["monitor_id"].text ?? "",
                     startedAt: $0["started_at"].date, endedAt: $0["ended_at"].date,
                     durationS: $0["duration_s"].int, cause: $0["cause"].text)
        }
        devices = j["devices"].array.map { DeviceCount(platform: $0["platform"].text ?? "?", devices: $0["devices"].int ?? 0) }.filter { !Labels.isRetired($0.platform) }
        let cron = j["scheduler"]["cron"]
        cronExists = cron.object != nil
        cronActive = cron["active"].bool ?? false
        cronSchedule = cron["schedule"].text
        cronLastStatus = cron["last_run"]["status"].text
        cronLastStart = cron["last_run"]["start"].date
        lastRunAt = j["scheduler"]["last_run_at"].date
        lastSource = j["scheduler"]["last_source"].text
        alertEmail = j["alerts"]["email"].text
        alertSMTP = j["alerts"]["smtp"].bool ?? false
        let ints = j["intervals"].array.compactMap(\.int)
        intervals = ints.isEmpty ? [5, 10, 15, 30, 60, 360, 720, 1440] : ints
        notices = j["all_notices"].array.map(StatusNotice.init).filter { $0.id > 0 }
        subscribersConfirmed = j["subscribers"].isNull ? nil : (j["subscribers"]["confirmed"].int ?? 0)
    }

    var allMonitors: [Monitor] { groups.flatMap(\.monitors) }

    func monitorName(_ id: String) -> String {
        allMonitors.first { $0.id == id }?.nameNl ?? id
    }

    var openIncidents: Int { incidents.filter { $0.endedAt == nil }.count }

    /// Monitors die in een melding kunnen staan (geen informatie-monitors), per groep.
    var noticeGroups: [Group] {
        groups.map { Group(id: $0.id, name: $0.name, monitors: $0.monitors.filter { !$0.isInfo }) }.filter { !$0.monitors.isEmpty }
    }

    func notice(_ id: Int) -> StatusNotice? { notices.first { $0.id == id } }
}

/// Eén melding (storing of gepland onderhoud) uit `all_notices` van `status` op `overview` (zoals in web/admin.js).
struct StatusNotice: Identifiable, Hashable {
    struct Component: Hashable {
        let id: String
        let impact: String
    }

    struct Update: Hashable, Identifiable {
        let id: Int
        let status: String
        let bodyNl: String
        let bodyEn: String
        let at: Date?
    }

    let id: Int
    let kind: String
    let titleNl: String
    let titleEn: String
    let impact: String
    let status: String
    let startedAt: Date?
    let resolvedAt: Date?
    let windowStart: Date?
    let windowEnd: Date?
    let components: [Component]
    let updates: [Update]
    let auto: Bool
    let autoResolve: Bool
    let notify: Bool

    init(_ j: JSON) {
        id = j["id"].int ?? 0
        kind = j["kind"].text ?? "incident"
        titleNl = j["title"]["nl"].text ?? ""
        titleEn = j["title"]["en"].text ?? titleNl
        impact = j["impact"].text ?? "minor"
        status = j["status"].text ?? "investigating"
        startedAt = j["started_at"].date
        resolvedAt = j["resolved_at"].date
        windowStart = j["window_start"].date
        windowEnd = j["window_end"].date
        components = j["components"].array.map { Component(id: $0["id"].text ?? "", impact: $0["impact"].text ?? "major") }
        updates = j["updates"].array.enumerated().map { i, u in
            let nl = u["body"]["nl"].text ?? ""
            return Update(id: i, status: u["status"].text ?? "", bodyNl: nl, bodyEn: u["body"]["en"].text ?? nl, at: u["at"].date)
        }
        auto = j["auto"].bool ?? false
        autoResolve = j["auto_resolve"].bool ?? false
        notify = j["notify"].bool ?? true
    }

    var isMaintenance: Bool { kind == "maintenance" }
    var isClosed: Bool { ["resolved", "completed", "cancelled"].contains(status) }
    /// Lopend: een storing die nog niet is opgelost, of onderhoud dat bezig is.
    var isOpen: Bool { (!isMaintenance && status != "resolved") || status == "in_progress" }
    var isPlanned: Bool { status == "scheduled" }

    /// Logische volgende status voor een update (zoals `next` in web/admin.js).
    var nextStatus: String {
        if isMaintenance { return status == "scheduled" ? "in_progress" : "completed" }
        switch status {
        case "investigating": return "identified"
        case "identified": return "monitoring"
        default: return "resolved"
        }
    }

    /// Kleur van de balk (zoals ntTone in web/admin.js).
    var toneColor: Color {
        if isMaintenance { return .stateInfo }
        if status == "resolved" { return .stateUp }
        switch impact {
        case "critical": return .stateDown
        case "major": return Color(hex: 0xFF7A3C)
        case "minor": return .stateDegraded
        default: return .stateNone
        }
    }
}

/// Labels en standaardteksten voor meldingen (zelfde als NST, IMPACT, CIMP en TPL in web/admin.js).
extension Labels {
    static let incidentStatuses = ["investigating", "identified", "monitoring", "resolved"]
    static let maintenanceStatuses = ["scheduled", "in_progress", "completed", "cancelled"]

    static func noticeStatus(_ k: String) -> String {
        ["investigating": "Wordt onderzocht", "identified": "Oorzaak bekend", "monitoring": "Wordt gevolgd", "resolved": "Opgelost",
         "scheduled": "Gepland", "in_progress": "Bezig", "completed": "Afgerond", "cancelled": "Geannuleerd"][k] ?? k
    }

    static let impacts: [Option] = [.init("none", "Geen"), .init("minor", "Klein"), .init("major", "Groot"), .init("critical", "Kritiek")]
    static func impact(_ k: String) -> String { impacts.first { $0.key == k }?.label ?? k }

    static let componentImpacts: [Option] = [.init("degraded", "Verminderd"), .init("partial", "Gedeeltelijk"), .init("major", "Storing")]
    static func componentImpact(_ k: String) -> String { componentImpacts.first { $0.key == k }?.label ?? k }

    /// Standaardtekst (NL, EN) voor een status; {c} = de getroffen onderdelen.
    static func noticeTemplate(_ status: String, nl: String, en: String) -> (String, String)? {
        let t: [String: (String, String)] = [
            "investigating": ("We onderzoeken een probleem met {c}. Zodra we meer weten, lees je het hier.",
                              "We're investigating an issue with {c}. We'll post an update as soon as we know more."),
            "identified": ("We hebben de oorzaak gevonden en werken aan een oplossing.", "We've identified the cause and are working on a fix."),
            "monitoring": ("Er is een oplossing doorgevoerd. We houden in de gaten of alles weer normaal werkt.",
                           "A fix has been implemented. We're monitoring the results."),
            "resolved": ("Het probleem is opgelost. Alles werkt weer normaal. Excuses voor het ongemak.",
                         "This issue has been resolved. Everything is working normally again. Sorry for the inconvenience."),
            "scheduled": ("We voeren gepland onderhoud uit aan {c}. Tijdens het onderhoud kan dit even niet werken.",
                          "We'll be performing scheduled maintenance on {c}. It may be briefly unavailable during this window."),
            "in_progress": ("Het onderhoud is begonnen.", "The maintenance has started."),
            "completed": ("Het onderhoud is afgerond. Alles werkt weer normaal.", "The maintenance has been completed. Everything is working normally."),
            "cancelled": ("Het geplande onderhoud gaat niet door.", "The scheduled maintenance has been cancelled."),
        ]
        guard let pair = t[status] else { return nil }
        return (pair.0.replacingOccurrences(of: "{c}", with: nl.isEmpty ? "een deel van Bingr" : nl),
                pair.1.replacingOccurrences(of: "{c}", with: en.isEmpty ? "part of Bingr" : en))
    }
}

struct Monitor: Identifiable, Hashable {
    struct DayBar: Hashable {
        let day: String
        let uptime: Double?
        let state: String
    }

    let id: String
    let group: String
    let nameNl: String
    let nameEn: String
    let state: String?
    let checkedAt: Date?
    let ms24: Double?
    let uptime1: Double?
    let uptime7: Double?
    let uptime30: Double?
    let uptime90: Double?
    let days: [DayBar]
    let kind: String
    let target: String?
    let keyword: String?
    let intervalMin: Int
    let isPublic: Bool
    let enabled: Bool
    let builtin: Bool
    let lastError: String?

    init(_ j: JSON, group: String) {
        id = j["id"].text ?? ""
        self.group = group
        nameNl = j["name"]["nl"].text ?? id
        nameEn = j["name"]["en"].text ?? nameNl
        state = j["state"].text
        checkedAt = j["checked_at"].date
        ms24 = j["ms24"].double
        uptime1 = j["uptime"]["d1"].double
        uptime7 = j["uptime"]["d7"].double
        uptime30 = j["uptime"]["d30"].double
        uptime90 = j["uptime"]["d90"].double
        days = j["days"].array.map { DayBar(day: $0["d"].text ?? "", uptime: $0["u"].double, state: $0["s"].text ?? "none") }
        kind = j["kind"].text ?? "http"
        target = j["target"].text
        keyword = j["keyword"].text
        intervalMin = j["interval_min"].int ?? 5
        isPublic = j["public"].bool ?? false
        enabled = j["enabled"].bool ?? true
        builtin = j["builtin"].bool ?? false
        lastError = j["last_error"].text
    }

    var isInfo: Bool { kind == "devices" }

    /// Toestand voor de stip: info, off, up/degraded/down of none.
    var dotState: String {
        if isInfo { return "info" }
        if !enabled { return "off" }
        return state ?? "none"
    }

    var stateText: String {
        if isInfo { return "informatie" }
        if !enabled { return "uit" }
        return Labels.monitorState(state)
    }
}

/// Eén controle uit `status` op `checks`.
struct MonitorCheck: Identifiable {
    let id = UUID()
    let at: Date?
    let ok: Bool
    let state: String
    let statusCode: Int?
    let ms: Double?
    let error: String?
    let detail: String?

    init(_ j: JSON) {
        at = j["at"].date
        ok = j["ok"].bool ?? false
        state = j["state"].text ?? "none"
        statusCode = j["status_code"].int
        ms = j["ms"].double
        error = j["error"].text
        detail = j["detail"].text
    }
}
