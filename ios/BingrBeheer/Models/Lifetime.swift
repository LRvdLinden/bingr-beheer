import Foundation

/// Build 167 (server): Bingr wordt alleen Lifetime. Zelfde contract als supabase/functions/admin/lifetime.ts en de tab
/// Lifetime-only van het web-dashboard. Alleen instellingen en aantallen; nooit adressen.
struct LifetimeSettings: Equatable {
    var enabled = false
    var announceAt: Date?
    var cutoverAt: Date?
    var discountPct = 30
    var codeValidUntil: Date?
    var trialDays = 0
    var iapApple = false
    var appleEU = false
    /// Voorstel van de server: vandaag + 30 dagen, 00:00 Nederlandse tijd (alleen bij lezen).
    var suggestedCutover: Date?

    init() {}

    init(_ j: JSON) {
        let l = j["lifetime_only"]
        enabled = l["enabled"].bool ?? false
        announceAt = l["announce_at"].date
        cutoverAt = l["cutover_at"].date
        discountPct = l["discount_pct"].int ?? 30
        codeValidUntil = l["code_valid_until"].date
        trialDays = l["trial_days"].int ?? 0
        iapApple = j["iap"]["apple"].bool ?? false
        appleEU = j["upgrade_link"]["apple_eu"].bool ?? false
        suggestedCutover = j["suggested_cutover_at"].date
    }

    /// ISO-tijd in Nederlandse tijd met offset, zoals de server hem opslaat ("2026-12-06T00:00:00+01:00").
    static func iso(_ d: Date?) -> Any {
        guard let d else { return NSNull() }
        let f = ISO8601DateFormatter()
        f.timeZone = Fmt.amsterdam
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: d)
    }

    /// Body van lifetime_settings {set: …}.
    var payload: [String: Any] {
        [
            "lifetime_only": [
                "enabled": enabled, "announce_at": Self.iso(announceAt), "cutover_at": Self.iso(cutoverAt),
                "discount_pct": discountPct, "code_valid_until": Self.iso(codeValidUntil), "trial_days": trialDays,
            ] as [String: Any],
            "iap": ["apple": iapApple],
            "upgrade_link": ["apple_eu": appleEU],
        ]
    }

    /// Stand in één regel.
    var phase: String {
        guard enabled else { return "Uit" }
        let now = Date()
        if let c = cutoverAt, now >= c { return "Overgang voorbij: alleen Lifetime" }
        if let a = announceAt, now < a { return "Aan, aankondiging gepland" }
        return "Aangekondigd"
    }

    /// Uitleg per bevestigingssleutel (409 confirm_required), zelfde teksten als web/admin.js.
    static let confirmText: [String: String] = [
        "enable": "Lifetime-only gaat AAN. Gratis accounts krijgen de aankondiging; na de overgangsdatum zien ze alleen nog Activeer Lifetime.",
        "cutover": "De overgangsdatum verandert terwijl Lifetime-only aan staat.",
        "trial": "De proefperiode voor nieuwe accounts verandert terwijl Lifetime-only aan staat.",
        "iap_apple": "De koopknop (In-app aankoop) verschijnt in de Apple-apps.",
        "apple_eu": "De EU-link naar bingr.online/upgrade/ verschijnt in de Apple-apps (alleen met de entitlement van Apple).",
        "generate": "Codes echt aanmaken in Stripe (coupon en een promotion code per gratis account).",
        "send": "De mail echt versturen aan alle gratis accounts die hem nog niet kregen.",
        "remind": "De herinnering echt versturen aan wie nog niet gekocht heeft.",
    ]
    static func confirmMessage(_ keys: [String]) -> String {
        keys.map { "• " + (confirmText[$0] ?? $0) }.joined(separator: "\n")
    }
}

/// Totalen van de kortingscodes (lifetime_codes_stats).
struct LifetimeStats {
    let created, mailed, mailError, reminded, redeemed, expired, open: Int
    let missing: Int?
    let validUntil: Date?

    init(_ j: JSON) {
        created = j["created"].int ?? 0
        mailed = j["mailed"].int ?? 0
        mailError = j["mail_error"].int ?? 0
        reminded = j["reminded"].int ?? 0
        redeemed = j["redeemed"].int ?? 0
        expired = j["expired"].int ?? 0
        open = j["open"].int ?? 0
        missing = j["missing"].int
        validUntil = j["valid_until"].date
    }
}

/// Aantallen van lifetime_mail (dry_run, test, send, remind).
struct LifetimeMailResult {
    let nl, en, total, sent, failed, remaining, withoutCode: Int
    let done: Bool

    init(_ j: JSON) {
        nl = j["recipients"]["nl"].int ?? 0
        en = j["recipients"]["en"].int ?? 0
        total = j["recipients"]["total"].int ?? (nl + en)
        sent = j["sent"].int ?? 0
        failed = j["failed"].int ?? 0
        remaining = j["remaining"].int ?? 0
        withoutCode = j["without_code"].int ?? 0
        done = j["done"].bool ?? true
    }

    var recipientsText: String {
        "\(Fmt.num(total)) ontvangers (\(Fmt.num(nl)) NL, \(Fmt.num(en)) EN)" + (withoutCode > 0 ? ", \(Fmt.num(withoutCode)) nog zonder code" : "")
    }
}

/// Code van één account (user_detail.lifetime_code), zonder Stripe-id's.
struct LifetimeCode {
    let code: String
    let status: String
    let expiresAt, mailedAt, remindedAt, redeemedAt: Date?
    let mailError: String?

    init?(_ j: JSON) {
        guard let c = j["code"].text else { return nil }
        code = c
        status = j["status"].text ?? "open"
        expiresAt = j["expires_at"].date
        mailedAt = j["mailed_at"].date
        remindedAt = j["reminded_at"].date
        redeemedAt = j["redeemed_at"].date
        mailError = j["mail_error"].text
    }

    var statusText: String {
        ["open": "nog niet gemaild", "mailed": "gemaild", "mail_error": "mailfout", "redeemed": "gebruikt", "expired": "verlopen"][status] ?? status
    }

    var detail: String {
        var parts: [String] = []
        if let r = redeemedAt { parts.append("gebruikt op \(Fmt.date(r))") }
        else if let m = mailedAt { parts.append("gemaild op \(Fmt.date(m))" + (remindedAt.map { ", herinnerd \(Fmt.date($0))" } ?? "")) }
        else if status == "mail_error", let e = mailError { parts.append("mailfout (\(e))") }
        if let e = expiresAt { parts.append("geldig t/m \(Fmt.date(e))") }
        return parts.joined(separator: " · ")
    }
}

/// Aanvulling 1: aankoop zonder account (purchases_unclaimed). Alleen id, aanbieder, status, bedrag en datum; nooit een e-mailadres.
struct UnclaimedPurchase: Identifiable, Hashable {
    let id: Int
    let provider: String
    let status: String
    let amount: Int
    let date: Date?
    let test: Bool
    let emailKnown: Bool

    init?(_ j: JSON) {
        guard let id = j["id"].int, id > 0 else { return nil }
        self.id = id
        provider = j["provider"].text ?? "stripe"
        status = j["status"].text ?? "paid"
        amount = j["amount"].int ?? 0
        date = j["paid_at"].date ?? j["created_at"].date
        test = j["mode"].text == "test"
        emailKnown = j["email_known"].bool ?? false
    }

    var text: String {
        let p = provider == "apple" ? "Apple" : "Website (Stripe)"
        let st = ["paid": "gekocht", "pending": "betaling onderweg", "refunded": "terugbetaald", "disputed": "chargeback", "failed": "mislukt"][status] ?? status
        return "#\(id) · \(p) · \(Fmt.euro(amount)) · \(st) \(Fmt.date(date))" + (test ? " · test" : "")
    }

    static func list(_ j: JSON) -> (total: Int, items: [UnclaimedPurchase]) {
        (j["total"].int ?? 0, j["items"].array.compactMap(UnclaimedPurchase.init))
    }
}
