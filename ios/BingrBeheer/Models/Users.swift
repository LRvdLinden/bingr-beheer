import Foundation

/// Rij uit `users` (e-mail gemaskeerd door de functie).
struct UserRow: Identifiable, Hashable {
    let id: String
    let email: String
    let createdAt: Date?
    let lastSignInAt: Date?
    let confirmed: Bool
    let deviceCount: Int
    let platforms: [String]
    let appVersions: [String]
    let profileCount: Int

    init(_ j: JSON) {
        id = j["id"].text ?? UUID().uuidString
        email = j["email"].text ?? ""
        createdAt = j["created_at"].date
        lastSignInAt = j["last_sign_in_at"].date
        confirmed = j["confirmed"].bool ?? false
        deviceCount = j["device_count"].int ?? 0
        platforms = j["platforms"].strings
        appVersions = j["app_versions"].strings
        profileCount = j["profile_count"].int ?? 0
    }
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
    let createdAt: Date?
    let lastSignInAt: Date?
    let confirmed: Bool
    let lang: String?
    let profileCount: Int
    let activeDays30d: Int
    let watchingNow: Int
    let emailOptOut: Bool
    let devices: [Device]

    init(_ j: JSON) {
        id = j["id"].text ?? ""
        email = j["email"].text ?? ""
        createdAt = j["created_at"].date
        lastSignInAt = j["last_sign_in_at"].date
        confirmed = j["confirmed"].bool ?? false
        lang = j["lang"].text
        profileCount = j["profile_count"].int ?? 0
        activeDays30d = j["active_days_30d"].int ?? 0
        watchingNow = j["watching_now"].int ?? 0
        emailOptOut = j["email_opt_out"].bool ?? false
        devices = j["devices"].array.map {
            Device(name: $0["name"].text, platform: $0["platform"].text, appVersion: $0["app_version"].text,
                   osVersion: $0["os_version"].text, createdAt: $0["created_at"].date, lastSeenAt: $0["last_seen_at"].date)
        }
    }
}
