import Foundation

/// Opmaak zoals het web-dashboard (nl-NL).
enum Fmt {
    static let nl = Locale(identifier: "nl_NL")

    static func num(_ n: Int?) -> String {
        (n ?? 0).formatted(.number.locale(nl))
    }

    /// Bedrag in centen als "€ 4,99" (aankopen, build 133).
    static func euro(_ cents: Int?) -> String {
        (Double(cents ?? 0) / 100).formatted(.currency(code: "EUR").locale(nl))
    }

    static func date(_ d: Date?) -> String {
        guard let d else { return "—" }
        return d.formatted(.dateTime.day().month(.abbreviated).year().locale(nl))
    }

    static func dateTime(_ d: Date?) -> String {
        guard let d else { return "—" }
        return d.formatted(.dateTime.day().month(.abbreviated).year().hour().minute().locale(nl))
    }

    /// Datum en tijd in Nederlandse tijd (Europe/Amsterdam), los van de tijdzone van het apparaat: "17 okt 2026, 08:02".
    static func dateTimeNL(_ d: Date?) -> String {
        guard let d else { return "—" }
        let style = Date.FormatStyle(locale: nl, timeZone: amsterdam)
            .day().month(.abbreviated).year().hour(.twoDigits(amPM: .omitted)).minute()
        return d.formatted(style)
    }

    static let amsterdam = TimeZone(identifier: "Europe/Amsterdam") ?? .current

    static func time(_ d: Date?) -> String {
        guard let d else { return "—" }
        return d.formatted(.dateTime.hour().minute().locale(nl))
    }

    static func shortDay(_ d: Date) -> String {
        d.formatted(.dateTime.day().month(.abbreviated).locale(nl))
    }

    static func longDay(_ d: Date) -> String {
        d.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(nl))
    }

    /// "zojuist", "5 min geleden", "3 uur geleden", "gisteren", "12 dagen geleden", daarna de datum.
    static func ago(_ d: Date?, never: String = "nooit") -> String {
        guard let d else { return never }
        let m = Int((Date().timeIntervalSince(d) / 60).rounded())
        if m < 2 { return "zojuist" }
        if m < 60 { return "\(m) min geleden" }
        let h = Int((Double(m) / 60).rounded())
        if h < 24 { return "\(h) uur geleden" }
        let days = Int((Double(h) / 24).rounded())
        if days == 1 { return "gisteren" }
        if days < 30 { return "\(days) dagen geleden" }
        return date(d)
    }

    static func pct(_ v: Double?) -> String {
        guard let v else { return "—" }
        return v.formatted(.number.precision(.fractionLength(0...2)).locale(nl)) + "%"
    }

    static func duration(seconds s: Int?) -> String {
        let m = Int((Double(s ?? 0) / 60).rounded())
        if m < 1 { return "< 1 min" }
        if m < 60 { return "\(m) min" }
        let h = m / 60
        return m % 60 == 0 ? "\(h) uur" : "\(h) uur \(m % 60) min"
    }

    static func interval(_ min: Int) -> String {
        min < 60 ? "elke \(min) min" : "elke \(min / 60) uur"
    }

    static func plural(_ n: Int, _ one: String, _ many: String) -> String {
        "\(num(n)) \(n == 1 ? one : many)"
    }
}

/// Vaste labels (zelfde teksten als web/admin.js).
enum Labels {
    static func platform(_ p: String?) -> String {
        switch p ?? "" {
        case "browser": return "Webbrowser"
        case "tizen": return "Samsung TV"
        case "", "?": return "Onbekend"
        default: return p ?? "Onbekend"
        }
    }

    /// SF Symbol per platform (zoals de iconen in het web-dashboard).
    static func platformIcon(_ p: String?) -> String {
        let s = (p ?? "").lowercased()
        if s == "apple tv" || s == "appletv" || s == "tvos" { return "appletv" }
        if s.contains("iphone") || s == "android" || s == "ios" { return "iphone" }
        if s.contains("ipad") || s.contains("tablet") { return "ipad" }
        if s.contains("mac") { return "laptopcomputer" }
        if s == "browser" || s == "web" { return "globe" }
        return "tv"
    }

    // support
    static let ticketStatus: [Option] = [
        .init("new", "Nieuw"), .init("open", "In behandeling"), .init("pending", "Wacht op klant"), .init("resolved", "Opgelost"), .init("closed", "Gesloten"),
    ]
    static func ticketStatus(_ k: String) -> String { ticketStatus.first { $0.key == k }?.label ?? k }

    static let supportFilters: [Option] = [
        .init("active", "Actief"), .init("new", "Nieuw"), .init("open", "In behandeling"), .init("pending", "Wacht op klant"),
        .init("resolved", "Opgelost"), .init("closed", "Gesloten"), .init("all", "Alles"),
    ]

    static let priorities: [Option] = [.init("low", "Laag"), .init("normal", "Normaal"), .init("high", "Hoog"), .init("urgent", "Urgent")]
    static func priority(_ k: String) -> String { priorities.first { $0.key == k }?.label ?? k }

    static func category(_ k: String) -> String {
        ["account": "Account", "afspelen": "Afspelen", "apps": "Apps", "website": "Website", "overig": "Overig"][k] ?? k
    }

    static func supportPlatform(_ k: String) -> String {
        ["ios": "iPhone/iPad", "tvos": "Apple TV", "macos": "Mac", "android": "Android", "androidtv": "Android TV",
         "tizen": "Samsung TV", "web": "Browser", "windows": "Windows"][k] ?? k
    }

    // build 146: diagnose-bijlage van tickets uit de app
    static func diagPlatform(_ k: String) -> String {
        ["ios": "iPhone", "ipados": "iPad"][k] ?? supportPlatform(k)
    }
    static func deviceType(_ k: String) -> String {
        ["phone": "Telefoon", "tablet": "Tablet", "tv": "Tv", "desktop": "Computer", "browser": "Browser"][k] ?? k
    }
    static func netType(_ k: String) -> String {
        ["wifi": "wifi", "ethernet": "kabel", "cellular": "mobiel", "none": "geen", "other": "anders", "unknown": "onbekend"][k] ?? k
    }
    /// Uitkomst van een netwerkcheck: label en toon.
    static func check(_ k: String) -> (String, Tone) {
        ["ok": ("ok", Tone.good), "slow": ("traag", .warn), "fail": ("mislukt", .bad), "skipped": ("overgeslagen", .neutral),
         "unknown": ("onbekend", .neutral)][k] ?? (k, .neutral)
    }

    /// Resultaten van de inbox-import: label en toon (good / bad / neutraal).
    static func inboxResult(_ k: String) -> (String, Tone) {
        let map: [String: (String, Tone)] = [
            "imported": ("Reactie klant", .good), "agent": ("Antwoord support → klant", .good), "new_ticket": ("Nieuw ticket", .good),
            "duplicate": ("Al verwerkt", .neutral), "ignored:own_system": ("Eigen melding", .neutral),
            "ignored:auto": ("Automatisch antwoord", .neutral), "ignored:bulk": ("Nieuwsbrief/lijst", .neutral),
            "ignored:bounce": ("Bounce", .neutral), "ignored:spam": ("Spam", .neutral),
            "rejected:sender_mismatch": ("Geweigerd: ander adres dan de klant", .bad),
            "rejected:agent_no_ticket": ("Geweigerd: geen ticket gevonden", .bad),
            "rejected:auth_failed": ("Geweigerd: SPF/DMARC afgekeurd", .bad), "rejected:rate_limited": ("Geweigerd: limiet", .bad),
            "rejected:empty": ("Geweigerd: geen tekst", .bad), "rejected:no_sender": ("Geweigerd: geen afzender", .bad),
            "rejected:bad_email": ("Geweigerd: ongeldig adres", .bad), "error": ("Fout (volgende ronde opnieuw)", .bad),
            "error:skipped": ("Fout, overgeslagen", .bad), "error:retry": ("Fout (volgende ronde opnieuw)", .bad),
            "ignored:not_ci": ("Testmap: geen testadres", .neutral), "rejected:agent_unverified": ("Geweigerd: support zonder DKIM", .bad),
        ]
        return map[k] ?? (k, .neutral)
    }

    // status
    static func monitorState(_ k: String?) -> String {
        ["up": "Werkt", "degraded": "Verminderd", "down": "Storing"][k ?? ""] ?? (k ?? "geen gegevens")
    }

    static let groups: [Option] = [.init("server", "Server"), .init("website", "Website"), .init("apps", "Apps")]

    static func monitorKind(_ k: String) -> String {
        ["http": "Website (URL)", "auth": "Supabase Auth", "db": "Database", "fn": "Edge Function", "storage": "Opslag",
         "smtp": "SMTP", "tls": "TLS-certificaat", "gh_asset": "GitHub-release", "build": "Build in de opslag", "gh_workflow": "GitHub-build",
         "devices": "Informatie"][k] ?? k
    }
}

/// Keuze met sleutel (zoals in de API) en Nederlands label.
struct Option: Hashable {
    let key: String
    let label: String

    init(_ key: String, _ label: String) {
        self.key = key
        self.label = label
    }
}

enum Tone {
    case good, bad, warn, neutral
}
