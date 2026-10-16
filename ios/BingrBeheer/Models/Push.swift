import Foundation

/// Doelgroep van een pushmelding (acties `push_count` en `push_send`; contract docs/PUSH.md in iptv-ios-appletv).
enum PushAudience: String, CaseIterable, Identifiable {
    case all, accounts, platforms

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "Alle gebruikers"
        case .accounts: return "Specifieke accounts"
        case .platforms: return "Platforms"
        }
    }
}

/// Keuze bij "Platforms": alleen platforms met systeem-push. tvOS, Android TV en Samsung TV staan er grijs bij.
struct PushPlatformOption: Identifiable, Hashable {
    let id: String
    let label: String
    /// Platformsleutels voor de functie (iPhone/iPad = ios + ipados).
    let keys: [String]
    let icon: String

    static let withPush: [PushPlatformOption] = [
        PushPlatformOption(id: "iphone", label: "iPhone/iPad", keys: ["ios", "ipados"], icon: "iphone"),
        PushPlatformOption(id: "mac", label: "Mac", keys: ["macos"], icon: "laptopcomputer"),
        PushPlatformOption(id: "android", label: "Android", keys: ["android"], icon: "iphone.gen1"),
        PushPlatformOption(id: "web", label: "Web", keys: ["web"], icon: "globe"),
    ]

    /// Geen systeem-push (alleen ter informatie, niet te kiezen).
    static let withoutPush: [PushPlatformOption] = [
        PushPlatformOption(id: "tvos", label: "Apple TV", keys: [], icon: "appletv"),
        PushPlatformOption(id: "androidtv", label: "Android TV", keys: [], icon: "tv"),
        PushPlatformOption(id: "tizen", label: "Samsung TV", keys: [], icon: "tv"),
    ]

    /// Naam van één platformsleutel uit de functie (by_platform, doelgroep in de geschiedenis).
    static func name(_ key: String) -> String {
        switch key {
        case "ios": return "iPhone"
        case "ipados": return "iPad"
        case "macos": return "Mac"
        case "android": return "Android"
        case "web": return "Web"
        default: return key
        }
    }

    /// "iPhone/iPad, Web" voor een lijst platformsleutels (ios en ipados samen).
    static func names(_ keys: [String]) -> String {
        var out: [String] = []
        for k in keys {
            let n = (k == "ios" || k == "ipados") ? "iPhone/iPad" : name(k)
            if !out.contains(n) { out.append(n) }
        }
        return out.joined(separator: ", ")
    }
}

/// Tellers van een pushmelding. APNs, FCM en Web Push melden alleen "aangenomen" of een fout: "afgeleverd" bestaat niet.
struct PushCounts: Equatable {
    var queued = 0
    var sent = 0
    var failed = 0
    var invalid = 0

    init(queued: Int = 0, sent: Int = 0, failed: Int = 0, invalid: Int = 0) {
        self.queued = queued
        self.sent = sent
        self.failed = failed
        self.invalid = invalid
    }

    init(_ j: JSON) {
        queued = max(0, j["queued"].int ?? 0)
        sent = max(0, j["sent"].int ?? 0)
        failed = max(0, j["failed"].int ?? 0)
        invalid = max(0, j["invalid"].int ?? 0)
    }

    var handled: Int { sent + failed + invalid }

    /// "1.196 verstuurd, 2 mislukt, 2 ongeldig, 40 in wachtrij" (zoals countsText in admin.js).
    var text: String {
        var bits = ["\(Fmt.num(sent)) verstuurd"]
        if failed > 0 { bits.append("\(Fmt.num(failed)) mislukt") }
        if invalid > 0 { bits.append("\(Fmt.num(invalid)) ongeldig") }
        if queued > 0 { bits.append("\(Fmt.num(queued)) in wachtrij") }
        return bits.joined(separator: ", ")
    }

    /// Melding van een kanaal (bv. "apns_not_configured") in gewone taal.
    static func note(_ code: String) -> String {
        switch code {
        case "apns_not_configured": return "APNs (Apple) niet ingesteld"
        case "fcm_not_configured": return "FCM (Android) niet ingesteld"
        case "webpush_not_configured", "vapid_not_configured": return "Web Push niet ingesteld"
        default: return code
        }
    }
}

/// Stand van het versturen (`push_send` en daarna `push_progress` tot done); blijft lopen als je van tab wisselt.
struct PushProgress: Equatable {
    var messageID: String?
    var devices: Int
    var counts: PushCounts
    var done: Bool
    var notes: [String]

    init(_ j: JSON) {
        messageID = j["message_id"].text
        counts = PushCounts(j)
        devices = j["devices"].int ?? counts.handled + counts.queued
        done = j["done"].bool ?? (counts.queued == 0)
        notes = j["notes"].strings
    }

    var fraction: Double {
        devices > 0 ? min(1, Double(counts.handled) / Double(devices)) : (done ? 1 : 0)
    }

    var text: String {
        var s = "Push: \(counts.text) van \(Fmt.plural(devices, "apparaat", "apparaten"))" + (done ? " · klaar" : "…")
        if !notes.isEmpty { s += " · " + notes.map(PushCounts.note).joined(separator: ", ") }
        return s
    }
}

/// Eén bericht uit `push_history` (zonder account-id's; de doelgroep is alleen soort en aantal).
struct PushMessage: Identifiable {
    let id: String
    let kind: String
    let createdAt: Date?
    let title: String?
    let body: String?
    let url: String?
    let targetType: String
    let targetCount: Int
    let targetPlatforms: [String]
    let platformGroup: String?
    let version: String?
    let build: Int?
    let devices: Int
    let counts: PushCounts
    let done: Bool
    let notes: [String]

    init(_ j: JSON) {
        id = j["id"].text ?? UUID().uuidString
        let k = j["kind"].text ?? "admin"
        kind = ["release", "admin", "reminder"].contains(k) ? k : "admin"
        createdAt = j["created_at"].date
        title = j["title"].text
        body = j["body"].text
        url = j["url"].text
        targetType = j["target"]["type"].text ?? "unknown"
        targetCount = j["target"]["count"].int ?? 0
        targetPlatforms = j["target"]["platforms"].strings
        platformGroup = j["platform_group"].text
        version = j["version"].text
        build = j["build"].int
        counts = PushCounts(j)
        devices = j["devices"].int ?? counts.handled + counts.queued
        done = j["done"].bool ?? (counts.queued == 0)
        notes = j["notes"].strings
    }

    var kindLabel: String {
        switch kind {
        case "release": return "Release"
        case "reminder": return "Herinnering"
        default: return "Beheer"
        }
    }

    var kindTone: Tone {
        switch kind {
        case "release": return .good
        case "reminder": return .neutral
        default: return .bad
        }
    }

    var displayTitle: String {
        if kind == "release" { return "Bingr \(version ?? "") (Build \(build.map(String.init) ?? "?")) is beschikbaar" }
        return title ?? (kind == "reminder" ? "Programmaherinnering" : "—")
    }

    var targetText: String {
        if kind == "release" {
            let g = platformGroup == "apple" ? "Apple (iPhone, iPad, Mac)" : platformGroup == "android" ? "Android" : platformGroup
            return g.map { "\($0), wie nog niet bijgewerkt is" } ?? "Wie nog niet bijgewerkt is"
        }
        switch targetType {
        case "all": return "Alle gebruikers"
        case "accounts": return Fmt.plural(targetCount, "account", "accounts")
        case "platforms": return PushPlatformOption.names(targetPlatforms)
        default: return kind == "reminder" ? "Eén account" : "—"
        }
    }

    /// Hostnaam van de link ("link naar bingr.online").
    var urlHost: String? { url.flatMap { URL(string: $0)?.host } }
}
