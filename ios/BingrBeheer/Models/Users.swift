import Foundation

/// Voor- en achternaam uit user_metadata (first_name / last_name): "Jan de Vries", of nil als er niets is.
enum PersonName {
    static func full(_ first: String?, _ last: String?) -> String? {
        let parts = [first, last].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }
}

/// Rij uit `users` (e-mail gemaskeerd door de functie; voor- en achternaam uit user_metadata, of nil).
struct UserRow: Identifiable, Hashable {
    let id: String
    let email: String
    let firstName: String?
    let lastName: String?
    let createdAt: Date?
    let lastSignInAt: Date?
    let confirmed: Bool
    let deviceCount: Int
    let platforms: [String]
    let appVersions: [String]
    let profileCount: Int
    /// Actieve blokkade (`blocked` niet leeg); einddatum nil = onbepaald.
    let isBlocked: Bool
    let blockedUntil: Date?
    /// Abonnement (`plan`: Gratis als het ontbreekt).
    let plan: AccountPlan
    /// Krijgt de nieuwsbrief (`newsletter`); nil = onbekend.
    let newsletter: Bool?

    init(_ j: JSON) {
        id = j["id"].text ?? UUID().uuidString
        newsletter = j["newsletter"].bool
        plan = AccountPlan(j["plan"])
        isBlocked = j["blocked"].object != nil
        blockedUntil = j["blocked"]["until"].date
        email = j["email"].text ?? ""
        firstName = j["first_name"].text
        lastName = j["last_name"].text
        createdAt = j["created_at"].date
        lastSignInAt = j["last_sign_in_at"].date
        confirmed = j["confirmed"].bool ?? false
        deviceCount = j["device_count"].int ?? 0
        platforms = j["platforms"].strings
        appVersions = j["app_versions"].strings
        profileCount = j["profile_count"].int ?? 0
    }

    /// "Jan de Vries", of nil zonder naam.
    var fullName: String? { PersonName.full(firstName, lastName) }
}

/// Antwoord van `user_detail`.
struct UserDetail {
    struct Device: Identifiable {
        let id = UUID()
        let name: String?
        let platform: String?
        let appVersion: String?
        let osVersion: String?
        let createdAt: Date?
        let lastSeenAt: Date?
    }

    let id: String
    let email: String
    let firstName: String?
    let lastName: String?
    let createdAt: Date?
    let lastSignInAt: Date?
    let confirmed: Bool
    let lang: String?
    let profileCount: Int
    let activeDays30d: Int
    let watchingNow: Int
    let emailOptOut: Bool
    /// Nieuwsbrief van dit account (`newsletter`); nil = onbekend (kolom nog niet aangemaakt).
    var newsletter: NewsletterPref?
    let devices: [Device]
    /// Xtream-server van het account (`servers`): alleen het adres (schema + host + poort), de naam van de klant en of het de
    /// actieve bron is. Nooit inloggegevens; M3U en andere soorten staan er niet in.
    struct Server: Identifiable {
        let id = UUID()
        let host: String
        let name: String?
        let active: Bool
    }
    /// nil = onbekend (de functie kon de servers niet lezen).
    let servers: [Server]?
    /// Actieve blokkade en de geschiedenis (nieuwste eerst, max. 20).
    let block: AccountBlock?
    let blocks: [AccountBlock]
    let plan: AccountPlan

    init(_ j: JSON) {
        id = j["id"].text ?? ""
        plan = AccountPlan(j["plan"])
        email = j["email"].text ?? ""
        firstName = j["first_name"].text
        lastName = j["last_name"].text
        createdAt = j["created_at"].date
        lastSignInAt = j["last_sign_in_at"].date
        confirmed = j["confirmed"].bool ?? false
        lang = j["lang"].text
        profileCount = j["profile_count"].int ?? 0
        activeDays30d = j["active_days_30d"].int ?? 0
        watchingNow = j["watching_now"].int ?? 0
        emailOptOut = j["email_opt_out"].bool ?? false
        newsletter = NewsletterPref(j["newsletter"])
        block = j["block"].object != nil ? AccountBlock(j["block"]) : nil
        blocks = j["blocks"].array.map(AccountBlock.init)
        if case .array(let list) = j["servers"] {
            servers = list.compactMap { s in
                guard let host = s["host"].text, s["deleted"].bool != true else { return nil }
                return Server(host: host, name: s["name"].text, active: s["active"].bool ?? false)
            }
        } else {
            servers = nil
        }
        devices = j["devices"].array.map {
            Device(name: $0["name"].text, platform: $0["platform"].text, appVersion: $0["app_version"].text,
                   osVersion: $0["os_version"].text, createdAt: $0["created_at"].date, lastSeenAt: $0["last_seen_at"].date)
        }
    }

    /// "Jan de Vries", of nil zonder naam.
    var fullName: String? { PersonName.full(firstName, lastName) }
}

/// Blokkade van een account (`account_blocks`): reden (ziet de klant), einddatum (nil = onbepaald) en hoe hij eindigde.
struct AccountBlock: Identifiable {
    let id: Int
    let reason: String
    let until: Date?
    let createdAt: Date?
    let notified: Bool
    let liftedAt: Date?
    let liftedBy: String?

    init(_ j: JSON) {
        id = j["id"].int ?? 0
        reason = j["reason"].text ?? ""
        until = j["until"].date
        createdAt = j["created_at"].date
        notified = j["notified"].bool ?? false
        liftedAt = j["lifted_at"].date
        liftedBy = j["lifted_by"].text
    }

    /// "tot 21 okt 2026 12:00" of "voor onbepaalde tijd"
    var untilText: String { until.map { "tot \(Fmt.dateTime($0))" } ?? "voor onbepaalde tijd" }

    var endedText: String? {
        guard let liftedAt else { return nil }
        let how: String
        switch liftedBy {
        case "beheer": how = "opgeheven"
        case "verlopen": how = "verlopen"
        case "vervangen": how = "vervangen"
        default: how = "beëindigd"
        }
        return "\(how) \(Fmt.date(liftedAt))"
    }
}

/// Abonnement van een account (`account_plans`; geen rij = Gratis). Standaardlimieten zoals de server
/// (supabase/functions/_shared/plans.ts in iptv-ios-appletv); eigen limieten nil = standaard.
struct AccountPlan: Hashable {
    static let defaults: [String: (streams: Int, devices: Int)] = ["free": (1, 8), "lifetime": (3, 15)]
    static let options: [Option] = [.init("free", "Gratis"), .init("lifetime", "Lifetime (gratis gegeven)")]

    let plan: String
    let maxStreams: Int?
    let maxDevices: Int?
    let source: String?
    let note: String?
    let updatedAt: Date?

    init(_ j: JSON) {
        plan = j["plan"].text == "lifetime" ? "lifetime" : "free"
        maxStreams = j["max_streams"].int
        maxDevices = j["max_devices"].int
        source = j["source"].text
        note = j["note"].text
        updatedAt = j["updated_at"].date
    }

    var isLifetime: Bool { plan == "lifetime" }
    var isCustom: Bool { maxStreams != nil || maxDevices != nil }
    var name: String { isLifetime ? "Lifetime" : "Gratis" }
    var streams: Int { maxStreams ?? AccountPlan.defaults[plan]!.streams }
    var devices: Int { maxDevices ?? AccountPlan.defaults[plan]!.devices }
    /// "Lifetime" of "Lifetime · 10/20" bij eigen limieten (streams/apparaten)
    var chipText: String { isCustom ? "\(name) · \(streams)/\(devices)" : name }

    var sourceText: String? {
        switch source {
        case "legacy": return "cadeau bij de invoering (bestaand account)"
        case "admin": return "via het beheer"
        case "purchase": return "gekocht"
        default: return nil
        }
    }
}
