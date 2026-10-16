import Foundation

/// Antwoord van `stats` (bingr_admin_stats + smtp).
struct Stats {
    struct Day: Identifiable {
        var id: Date { day }
        let day: Date
        let newUsers: Int
        let signins: Int
        /// accounts met app-activiteit op die dag (dashboard-widget "Per dag")
        var activeUsers: Int = 0
    }

    struct PlatformCount: Identifiable {
        let id = UUID()
        let platform: String
        let version: String?
        let devices: Int
    }

    let totalUsers: Int
    let confirmedUsers: Int
    let newUsers7d: Int
    let activeToday: Int
    let active30d: Int
    let devicesTotal: Int
    let watchingNow: Int
    /// Accounts die zich hebben afgemeld voor berichten per e-mail.
    let optedOut: Int?
    /// Accounts met een actieve blokkade (nil bij een ouder schema).
    let blockedUsers: Int?
    /// Abonnementen (nil bij een ouder schema): Gratis, Lifetime en accounts met eigen limieten.
    let planFree: Int?
    let planLifetime: Int?
    let planCustom: Int?
    /// "audit": inlogs uit het inloglogboek; anders accounts met app-activiteit
    let signinsFromAudit: Bool
    let days: [Day]
    let platforms: [PlatformCount]
    let versions: [PlatformCount]
    let smtp: Bool

    init(_ j: JSON) {
        totalUsers = j["total_users"].int ?? 0
        confirmedUsers = j["confirmed_users"].int ?? 0
        newUsers7d = j["new_users_7d"].int ?? 0
        activeToday = j["active_today"].int ?? 0
        active30d = j["active_30d"].int ?? 0
        devicesTotal = j["devices_total"].int ?? 0
        watchingNow = j["watching_now"].int ?? 0
        optedOut = j["opted_out"].int
        blockedUsers = j["blocked_users"].int
        planFree = j["plan_free"].int
        planLifetime = j["plan_lifetime"].int
        planCustom = j["plan_custom"].int
        signinsFromAudit = j["signins_source"].text == "audit"
        days = j["days"].array.compactMap { d in
            guard let day = d["day"].date else { return nil }
            return Day(day: day, newUsers: d["new_users"].int ?? 0, signins: d["signins"].int ?? 0,
                       activeUsers: d["active_users"].int ?? 0)
        }
        platforms = j["platforms"].array.map {
            PlatformCount(platform: $0["platform"].text ?? "?", version: nil, devices: $0["devices"].int ?? 0)
        }
        versions = j["versions"].array.map {
            PlatformCount(platform: $0["platform"].text ?? "?", version: $0["app_version"].text ?? "?", devices: $0["devices"].int ?? 0)
        }
        smtp = j["smtp"].bool ?? false
    }
}
