import Foundation

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
        devices = j["devices"].array.map { DeviceCount(platform: $0["platform"].text ?? "?", devices: $0["devices"].int ?? 0) }
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
    }

    var allMonitors: [Monitor] { groups.flatMap(\.monitors) }

    func monitorName(_ id: String) -> String {
        allMonitors.first { $0.id == id }?.nameNl ?? id
    }

    var openIncidents: Int { incidents.filter { $0.endedAt == nil }.count }
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
