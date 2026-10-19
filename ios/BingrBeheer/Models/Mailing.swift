import Foundation

/// Eigen mailing vanuit het beheer (acties `mailing_*` van de functie admin → functie newsletter in iptv-ios-appletv; zoals
/// het blok "Eigen mailing" in web/admin.js). Alleen onderwerpen en aantallen: nooit adressen.
enum MailingAudience: String, CaseIterable, Identifiable {
    case newsletter, service
    var id: String { rawValue }

    var title: String {
        switch self {
        case .newsletter: return "Nieuwsbrief-abonnees"
        case .service: return "Servicebericht aan alle gebruikers"
        }
    }

    var short: String {
        switch self {
        case .newsletter: return "Nieuwsbrief"
        case .service: return "Servicebericht"
        }
    }

    var help: String {
        switch self {
        case .newsletter:
            return "Leden die de nieuwsbrief willen ontvangen (bevestigd e-mailadres, niet afgemeld). Met afmeldlink en afmelden met één klik."
        case .service:
            return "Alle leden met een bevestigd e-mailadres (niet geblokkeerd of verwijderd), ook wie zich heeft afgemeld. Zonder afmeldlink; onderaan staat waarom ze dit krijgen."
        }
    }

    /// Waarschuwing bij een servicebericht (AVG / Telecommunicatiewet), gelijk aan het web-dashboard.
    static let serviceWarning = "Alleen voor belangrijke service-informatie. Een servicebericht gaat naar alle leden met een bevestigd e-mailadres, ook naar wie zich voor de nieuwsbrief of alle berichten heeft afgemeld, en heeft geen afmeldlink. Gebruik het alleen voor bijvoorbeeld een wijziging van de voorwaarden of de privacyverklaring, een storing of beveiligingsinformatie. Nooit voor reclame, acties of nieuws: dat mag volgens de AVG en de Telecommunicatiewet (art. 11.7) alleen naar wie zich niet heeft afgemeld (kies dan Nieuwsbrief-abonnees)."
}

struct MailingCounts: Equatable {
    var nl = 0
    var en = 0
    var total = 0

    init() {}
    init(_ j: JSON) {
        nl = max(0, j["nl"].int ?? 0)
        en = max(0, j["en"].int ?? 0)
        total = max(0, j["total"].int ?? (nl + en))
    }
}

struct MailingItem: Identifiable, Equatable {
    let id: Int
    let createdAt: Date?
    let finishedAt: Date?
    let audience: MailingAudience
    let status: String
    let subjectNl: String
    let subjectEn: String
    let recipients: MailingCounts
    let sent: Int
    let failed: Int
    let skipped: Int
    let cancelled: Int
    let left: Int

    init(_ j: JSON) {
        id = j["id"].int ?? 0
        createdAt = j["created_at"].date
        finishedAt = j["finished_at"].date
        audience = MailingAudience(rawValue: j["audience"].string ?? "") ?? .newsletter
        status = ["sending", "done", "cancelled"].contains(j["status"].string ?? "") ? j["status"].string! : "done"
        subjectNl = j["subject"]["nl"].string ?? ""
        subjectEn = j["subject"]["en"].string ?? ""
        recipients = MailingCounts(j["recipients"])
        sent = max(0, j["sent"].int ?? 0)
        failed = max(0, j["failed"].int ?? 0)
        skipped = max(0, j["skipped"].int ?? 0)
        cancelled = max(0, j["cancelled"].int ?? 0)
        left = max(0, j["left"].int ?? 0)
    }

    /// Deel dat klaar is (verstuurd, mislukt, overgeslagen of geannuleerd), 0…1.
    var progress: Double {
        guard recipients.total > 0 else { return 0 }
        return min(1, Double(sent + failed + skipped + cancelled) / Double(recipients.total))
    }

    var statusText: String {
        switch status {
        case "sending": return "bezig"
        case "cancelled": return "geannuleerd"
        default: return "klaar"
        }
    }

    var statusTone: Tone {
        switch status {
        case "sending": return .warn
        case "cancelled": return .bad
        default: return .neutral
        }
    }
}

struct MailingStatus: Equatable {
    let active: MailingItem?
    let mailings: [MailingItem]
    let newsletter: MailingCounts
    let service: MailingCounts
    let perHour: Int
    let batch: Int
    let sentLastHour: Int

    init(_ j: JSON) {
        active = j["active"].object != nil ? MailingItem(j["active"]) : nil
        mailings = j["mailings"].array.map(MailingItem.init).filter { $0.id > 0 }
        newsletter = MailingCounts(j["audiences"]["newsletter"])
        service = MailingCounts(j["audiences"]["service"])
        perHour = max(0, j["per_hour"].int ?? 0)
        batch = max(0, j["batch"].int ?? 0)
        sentLastHour = max(0, j["sent_last_hour"].int ?? 0)
    }

    func counts(_ a: MailingAudience) -> MailingCounts { a == .service ? service : newsletter }

    /// "binnen een uur" / "ongeveer 5 uur" bij de limiet per uur.
    func duration(_ n: Int) -> String {
        guard perHour > 0, n > perHour else { return "binnen een uur" }
        return "ongeveer \((n + perHour - 1) / perHour) uur"
    }
}

/// Concept van een mailing (wordt per apparaat bewaard in UserDefaults; geen adressen).
struct MailingDraft: Codable, Equatable {
    var audience = MailingAudience.newsletter.rawValue
    var subjectNl = ""
    var bodyNl = ""
    var buttonNl = ""
    var subjectEn = ""
    var bodyEn = ""
    var buttonEn = ""
    var image = ""
    var buttonURL = ""

    static let key = "mailing.draft"

    static func load() -> MailingDraft {
        guard let data = UserDefaults.standard.data(forKey: key),
              let d = try? JSONDecoder().decode(MailingDraft.self, from: data) else { return MailingDraft() }
        return d
    }

    func save() {
        if let data = try? JSONEncoder().encode(self) { UserDefaults.standard.set(data, forKey: Self.key) }
    }

    /// `content` zoals de functie admin hem verwacht.
    var content: [String: Any] {
        [
            "nl": ["subject": subjectNl, "body": bodyNl, "button": buttonNl],
            "en": ["subject": subjectEn, "body": bodyEn, "button": buttonEn],
            "image": image.trimmingCharacters(in: .whitespacesAndNewlines),
            "button_url": buttonURL.trimmingCharacters(in: .whitespacesAndNewlines),
        ]
    }

    /// Eenvoudige controle vóór een aanvraag (de functies controleren alles nog een keer, strenger); foutcode of nil.
    func check(_ langs: [String]) -> String? {
        func https(_ s: String) -> Bool {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty || (t.lowercased().hasPrefix("https://") && t.count > 8 && !t.contains(where: { $0.isWhitespace || "\"'<>\\`".contains($0) }))
        }
        let empty = { (s: String) in s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        if !https(image) { return "bad_image_url" }
        if !https(buttonURL) { return "bad_button_url" }
        let fields: [(String, String, String, String)] = [("nl", subjectNl, bodyNl, buttonNl), ("en", subjectEn, bodyEn, buttonEn)]
        for (l, s, b, btn) in fields where langs.contains(l) {
            if empty(s) || s.count > 150 { return "bad_subject_\(l)" }
            if empty(b) || b.count > 8000 { return "bad_body_\(l)" }
            if !empty(buttonURL) && (empty(btn) || btn.count > 40) { return "bad_button_text_\(l)" }
        }
        if empty(buttonURL) && (!empty(buttonNl) || !empty(buttonEn)) { return "bad_button_url" }
        return nil
    }
}
