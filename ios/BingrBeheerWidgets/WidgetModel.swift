import Foundation
import SwiftUI
import WidgetKit

/// Antwoord van `widget_summary` (functie admin): alleen statusnamen en aantallen, geen persoonsgegevens.
struct WidgetSummary: Codable, Hashable {
    struct Component: Codable, Hashable, Identifiable {
        let id: String
        let name: String
        let group: String
        let level: String
    }

    struct Status: Codable, Hashable {
        let level: String
        let components: [Component]
        let counts: [String: Int]
        let activeNotices: Int
        let openIncidents: Int
        let checkedAt: Date?

        func count(_ level: String) -> Int { counts[level] ?? 0 }
        var problems: [Component] { components.filter { $0.level != "operational" } }
        var total: Int { counts.values.reduce(0, +) }
        var problemCount: Int { total - count("operational") }
    }

    struct Support: Codable, Hashable {
        let new, open, pending, resolved, closed, active, unread, total, last7d: Int

        /// Open: in behandeling, en desgewenst ook "wacht op klant".
        func openCount(includePending: Bool) -> Int { open + (includePending ? pending : 0) }
        /// Afgerond: opgelost + gesloten.
        var done: Int { resolved + closed }
    }

    let status: Status?
    let support: Support?
    let generatedAt: Date

    init(status: Status?, support: Support?, generatedAt: Date) {
        self.status = status
        self.support = support
        self.generatedAt = generatedAt
    }

    init(_ j: JSON) {
        let s = j["status"]
        if s.object != nil {
            var counts: [String: Int] = [:]
            for (k, v) in s["counts"].object ?? [:] { counts[k] = v.int ?? 0 }
            status = Status(
                level: s["level"].text ?? "unknown",
                components: s["components"].array.map {
                    Component(id: $0["id"].text ?? UUID().uuidString, name: $0["name"].text ?? $0["id"].text ?? "?",
                              group: $0["group"].text ?? "", level: $0["level"].text ?? "unknown")
                },
                counts: counts,
                activeNotices: s["active_notices"].int ?? 0,
                openIncidents: s["open_incidents"].int ?? 0,
                checkedAt: s["checked_at"].date)
        } else {
            status = nil
        }
        let p = j["support"]
        if p.object != nil {
            support = Support(new: p["new"].int ?? 0, open: p["open"].int ?? 0, pending: p["pending"].int ?? 0,
                              resolved: p["resolved"].int ?? 0, closed: p["closed"].int ?? 0, active: p["active"].int ?? 0,
                              unread: p["unread"].int ?? 0, total: p["total"].int ?? 0, last7d: p["last_7d"].int ?? 0)
        } else {
            support = nil
        }
        generatedAt = j["generated_at"].date ?? Date()
    }

    /// Voorbeeld voor de widgetgalerij en de placeholder (verzonnen aantallen, algemene namen).
    static let sample = WidgetSummary(
        status: Status(level: "operational",
                       components: [
                           Component(id: "website", name: "Website", group: "Website", level: "operational"),
                           Component(id: "api", name: "API", group: "Server", level: "operational"),
                           Component(id: "auth", name: "Accounts", group: "Server", level: "operational"),
                           Component(id: "db", name: "Database", group: "Server", level: "operational"),
                           Component(id: "apps", name: "Apps", group: "Apps", level: "operational"),
                       ],
                       counts: ["operational": 5], activeNotices: 0, openIncidents: 0, checkedAt: Date()),
        support: Support(new: 2, open: 3, pending: 1, resolved: 12, closed: 40, active: 6, unread: 2, total: 58, last7d: 5),
        generatedAt: Date())
}

/// Niveau van een onderdeel of het geheel (zelfde niveaus als de statuspagina).
enum StatusLevel {
    static func title(_ l: String) -> String {
        switch l {
        case "operational": return "Alles werkt"
        case "maintenance": return "Onderhoud"
        case "degraded": return "Verminderde prestaties"
        case "partial": return "Gedeeltelijke storing"
        case "major": return "Grote storing"
        default: return "Onbekend"
        }
    }

    static func short(_ l: String) -> String {
        switch l {
        case "operational": return "Werkt"
        case "maintenance": return "Onderhoud"
        case "degraded": return "Verminderd"
        case "partial": return "Gedeeltelijk"
        case "major": return "Storing"
        default: return "Onbekend"
        }
    }

    static func color(_ l: String) -> Color {
        switch l {
        case "operational": return .stateUp
        case "maintenance": return .stateInfo
        case "degraded": return .stateDegraded
        case "partial": return Color(hex: 0xFF7A3C)
        case "major": return .stateDown
        default: return .textDim
        }
    }

    static func icon(_ l: String) -> String {
        switch l {
        case "operational": return "checkmark.circle.fill"
        case "maintenance": return "wrench.and.screwdriver.fill"
        case "degraded": return "exclamationmark.triangle.fill"
        case "partial": return "exclamationmark.octagon.fill"
        case "major": return "xmark.octagon.fill"
        default: return "questionmark.circle.fill"
        }
    }
}

/// Wat een widget toont.
enum WidgetLoad: Hashable {
    /// Gegevens; `stale` = laatst bekende stand (geen verbinding).
    case ok(WidgetSummary, stale: Bool)
    /// Geen (geldig) widget-token: "Open Bingr Beheer om in te loggen".
    case signedOut
    /// Geen verbinding en nog niets bewaard.
    case failed
}

/// Stand van een widget met zijn instellingen (C = het configuratie-intent, of NoWidgetConfig).
struct SummaryEntry<C>: TimelineEntry {
    let date: Date
    let load: WidgetLoad
    let config: C

    static func sample(_ config: C) -> SummaryEntry<C> { SummaryEntry(date: Date(), load: .ok(.sample, stale: false), config: config) }
}

/// Voor de gecombineerde widget (geen instellingen).
struct NoWidgetConfig {}

/// Haalt `widget_summary` op met het widget-token (publieke Supabase-URL en publishable key uit Config) en bewaart de
/// laatste stand in de eigen opslag van de extensie (alleen aantallen en statusnamen).
enum SummaryLoader {
    private static let cacheKey = "widget.summary"

    static func load() async -> WidgetLoad {
        guard let cred = WidgetTokenStore.read(), cred.isValid else {
            clearCache()
            return .signedOut
        }
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 20
        cfg.timeoutIntervalForResource = 25
        cfg.waitsForConnectivity = false
        let api = AdminAPI(session: URLSession(configuration: cfg))
        do {
            let summary = WidgetSummary(try await api.send("widget_summary", token: cred.token))
            saveCache(summary)
            return .ok(summary, stale: false)
        } catch let e as APIError where e.status == 401 {
            // ingetrokken (overal uitloggen, ander wachtwoord) of verlopen: opnieuw inloggen in de app
            clearCache()
            return .signedOut
        } catch {
            if let cached = readCache() { return .ok(cached, stale: true) }
            return .failed
        }
    }

    static func entry<C>(_ config: C, preview: Bool) async -> SummaryEntry<C> {
        if preview { return .sample(config) }
        let l = await load()
        return SummaryEntry(date: Date(), load: l, config: config)
    }

    static func timeline<C>(_ config: C) async -> Timeline<SummaryEntry<C>> {
        let l = await load()
        let now = Date()
        // uitgelogd: de app herlaadt de widgets na inloggen; daarom hier rustig aan
        let next = now.addingTimeInterval(l == .signedOut ? 3 * 3600 : WidgetShared.refreshInterval)
        return Timeline(entries: [SummaryEntry(date: now, load: l, config: config)], policy: .after(next))
    }

    private static func saveCache(_ s: WidgetSummary) {
        if let data = try? JSONEncoder().encode(s) { UserDefaults.standard.set(data, forKey: cacheKey) }
    }

    private static func readCache() -> WidgetSummary? {
        guard let data = UserDefaults.standard.data(forKey: cacheKey) else { return nil }
        return try? JSONDecoder().decode(WidgetSummary.self, from: data)
    }

    private static func clearCache() {
        UserDefaults.standard.removeObject(forKey: cacheKey)
    }
}
