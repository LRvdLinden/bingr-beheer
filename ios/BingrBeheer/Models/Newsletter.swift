import Foundation

/// Stand van de nieuwsbrief (actie `newsletter_status` van de functie admin → functie newsletter in iptv-ios-appletv).
/// Alleen aantallen: nooit adressen.
struct NewsletterStatus: Equatable {
    struct Edition: Identifiable, Equatable {
        let id: String
        let key: String?
        let createdAt: Date?
        let recipients: Int
        let sent: Int
        let failed: Int
        let done: Bool

        init(_ j: JSON, index: Int) {
            key = j["key"].text
            createdAt = j["created_at"].date
            recipients = max(0, j["recipients"].int ?? 0)
            sent = max(0, j["sent"].int ?? 0)
            failed = max(0, j["failed"].int ?? 0)
            done = j["done"].bool ?? (recipients > 0 && sent + failed >= recipients)
            id = "\(key ?? "editie")-\(index)"
        }
    }

    var enabled: Bool
    let nextAt: Date?
    let nextKey: String?
    let recipientsNl: Int
    let recipientsEn: Int
    let recipientsTotal: Int
    let editions: [Edition]

    init(_ j: JSON) {
        enabled = j["enabled"].bool ?? false
        nextAt = j["next"]["at"].date
        nextKey = j["next"]["key"].text
        recipientsNl = max(0, j["recipients"]["nl"].int ?? 0)
        recipientsEn = max(0, j["recipients"]["en"].int ?? 0)
        recipientsTotal = max(0, j["recipients"]["total"].int ?? (recipientsNl + recipientsEn))
        editions = j["editions"].array.enumerated().map { Edition($0.element, index: $0.offset) }
    }

    /// Afzender van de nieuwsbrief (zoals in het web-dashboard).
    static let sender = "noreply@bingr.online"
}

/// Nieuwsbrief van één account (`user_detail.newsletter`, actie `user_newsletter_set`). nil in `UserDetail` = onbekend
/// (bv. de kolom newsletter_opt_out bestaat nog niet).
struct NewsletterPref: Equatable {
    var subscribed: Bool
    var emailOptOut: Bool
    var newsletterOptOut: Bool

    init?(_ j: JSON) {
        guard j.object != nil else { return nil }
        emailOptOut = j["email_opt_out"].bool ?? false
        newsletterOptOut = j["newsletter_opt_out"].bool ?? false
        subscribed = j["subscribed"].bool ?? (!emailOptOut && !newsletterOptOut)
    }
}

/// Eenvoudige controle vóór versturen (de functie controleert het adres nog een keer, strenger).
enum EmailCheck {
    static func looksValid(_ s: String) -> Bool {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.count <= 254, !t.contains(where: { $0.isWhitespace || "<>,;".contains($0) }) else { return false }
        let parts = t.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty else { return false }
        let labels = parts[1].split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2, labels.allSatisfy({ !$0.isEmpty }), let tld = labels.last, tld.count >= 2,
              tld.allSatisfy({ $0.isLetter }) else { return false }
        return true
    }
}

extension Fmt {
    /// "zondag 18 oktober, 09:00" in Nederlandse tijd (volgende verzending van de nieuwsbrief).
    static func longDateTimeNL(_ d: Date?) -> String {
        guard let d else { return "—" }
        let style = Date.FormatStyle(locale: nl, timeZone: amsterdam)
            .weekday(.wide).day().month(.wide).hour(.twoDigits(amPM: .omitted)).minute()
        return d.formatted(style)
    }
}
