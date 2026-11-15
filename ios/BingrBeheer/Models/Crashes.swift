import Foundation

/// Tab Crashes (actie `crashes` van de functie admin, build 171 van Bingr): eigen crashrapporten van de apps en de webspeler,
/// gegroepeerd op handtekening. Zelfde vorm als supabase/functions/admin/crashes.ts (listView / detailView).
struct CrashGroup: Identifiable, Hashable {
    var id: String { signature }
    let signature: String
    let kind: String
    let reports: Int
    let occurrences: Int
    let platforms: [String]
    let builds: [Int]
    let devices: Int
    let firstSeen: Date?
    let lastSeen: Date?
    let message: String?
    let status: String
    let resolvedBuild: Int?

    init(_ j: JSON) {
        signature = j["signature"].text ?? ""
        kind = j["kind"].text ?? "crash"
        reports = j["reports"].int ?? 0
        occurrences = j["occurrences"].int ?? reports
        platforms = j["platforms"].strings
        builds = j["builds"].array.compactMap { $0.int }
        devices = j["devices"].int ?? 0
        firstSeen = j["first_seen"].date
        lastSeen = j["last_seen"].date
        message = j["message"].text
        status = j["status"].text ?? "open"
        resolvedBuild = j["resolved_build"].int
    }

    var kindText: String { CrashGroup.kindText(kind) }
    static func kindText(_ k: String) -> String { ["crash": "Crash", "anr": "Vastgelopen", "error": "Fout"][k] ?? k }
    var statusText: String {
        switch status {
        case "resolved": return "Opgelost in \(resolvedBuild.map(String.init) ?? "?")"
        case "regressed": return "Teruggekomen (opgelost in \(resolvedBuild.map(String.init) ?? "?"))"
        default: return "Open"
        }
    }
    var tone: Tone { status == "regressed" ? .bad : status == "resolved" ? .good : .warn }
}

struct CrashList {
    let groups: [CrashGroup]
    let platforms: [String]
    let builds: [Int]
    let total: Int
    let open: Int
    let regressed: Int
    let reports24h: Int

    init(_ j: JSON) {
        groups = j["groups"].array.map(CrashGroup.init).filter { !$0.signature.isEmpty }
        platforms = j["platforms"].strings
        builds = j["builds"].array.compactMap { $0.int }
        let t = j["totals"]
        total = t["groups"].int ?? 0
        open = t["open"].int ?? 0
        regressed = t["regressed"].int ?? 0
        reports24h = t["reports_24h"].int ?? 0
    }
}

struct CrashReport: Identifiable, Hashable {
    let id: Int
    let at: Date?
    let platform: String?
    let appVersion: String?
    let build: Int?
    let osVersion: String?
    let deviceModel: String?
    let message: String?
    let stack: String?
    let count: Int
    let signedIn: Bool

    init(_ j: JSON) {
        id = j["id"].int ?? 0
        at = j["occurred_at"].date ?? j["created_at"].date
        platform = j["platform"].text
        appVersion = j["app_version"].text
        build = j["build"].int
        osVersion = j["os_version"].text
        deviceModel = j["device_model"].text
        message = j["message"].text
        stack = j["stack"].string
        count = j["count"].int ?? 1
        signedIn = j["signed_in"].bool ?? false
    }
}

struct CrashDetail {
    let status: String
    let resolvedBuild: Int?
    let kind: String
    let firstSeen: Date?
    let lastSeen: Date?
    let reports: [CrashReport]

    init(_ j: JSON) {
        let g = j["group"]
        status = g["status"].text ?? "open"
        resolvedBuild = g["resolved_build"].int
        kind = g["kind"].text ?? "crash"
        firstSeen = g["first_seen"].date
        lastSeen = g["last_seen"].date
        reports = j["reports"].array.map(CrashReport.init)
    }
}
