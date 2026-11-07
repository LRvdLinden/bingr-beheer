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
    /// Build 168: nieuwe accounts eerst kopen, per platformgroep (nil = uit). Web en Android (ook Windows en de website).
    var newPaidFrom: Date?
    /// Build 168: hetzelfde voor de Apple-apps (pas na de goedkeuring van Apple).
    var newPaidFromApple: Date?
    var iapApple = false
    var appleEU = false
    /// Voorstel van de server (aanvulling 2): vast 1 december 2026, 00:00 Nederlandse tijd, ook voor de code (alleen bij lezen).
    var suggestedCutover: Date?
    var suggestedCodeValidUntil: Date?

    init() {}

    init(_ j: JSON) {
        let l = j["lifetime_only"]
        enabled = l["enabled"].bool ?? false
        announceAt = l["announce_at"].date
        cutoverAt = l["cutover_at"].date
        discountPct = l["discount_pct"].int ?? 30
        codeValidUntil = l["code_valid_until"].date
        trialDays = l["trial_days"].int ?? 0
        newPaidFrom = l["new_paid_from"].date
        newPaidFromApple = l["new_paid_from_apple"].date
        iapApple = j["iap"]["apple"].bool ?? false
        appleEU = j["upgrade_link"]["apple_eu"].bool ?? false
        suggestedCutover = j["suggested_cutover_at"].date
        suggestedCodeValidUntil = j["suggested_code_valid_until"].date ?? suggestedCutover
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
                "new_paid_from": Self.iso(newPaidFrom), "new_paid_from_apple": Self.iso(newPaidFromApple),
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
        "new_paid": "Nieuwe accounts moeten op web en Android (ook Windows en de website) eerst Lifetime kopen. Bestaande gratis accounts blijven gratis tot de overgangsdatum.",
        "new_paid_apple": "Nieuwe accounts moeten in de Apple-apps eerst Lifetime kopen. Bestaande gratis accounts blijven gratis tot de overgangsdatum.",
    ]

    /// Build 168: waarschuwingen (lifetime.ts warnings), zelfde teksten als web/admin.js.
    static let warningText: [String: String] = [
        "new_paid_apple_no_iap": "Let op: de koopknop in de Apple-apps (In-app aankoop) staat uit. Nieuwe accounts kunnen in de Apple-apps dan niets: geen koopknop en geen gratis toegang.",
        "new_paid_disabled": "Let op: Lifetime-only staat uit, dus de datum voor nieuwe accounts doet nu niets.",
    ]
    static func warningMessage(_ keys: [String]) -> String {
        keys.map { warningText[$0] ?? $0 }.joined(separator: "\n")
    }
    /// Waarschuwingen voor de huidige invoer (zoals de functie ze geeft).
    var warnings: [String] {
        var w: [String] = []
        if newPaidFromApple != nil && !iapApple { w.append("new_paid_apple_no_iap") }
        if !enabled && (newPaidFrom != nil || newPaidFromApple != nil) { w.append("new_paid_disabled") }
        return w
    }
    static func confirmMessage(_ keys: [String]) -> String {
        keys.map { "• " + (confirmText[$0] ?? $0) }.joined(separator: "\n")
    }
}

/// Totalen van de kortingscodes (lifetime_codes_stats; bingr_admin_lifetime_stats).
struct LifetimeStats {
    let created, ready, pendingStripe, mailed, mailError, reminded, remindError, redeemed, expired, open: Int
    let candidates, mailPending, remindPending, unclaimed: Int

    init(_ j: JSON) {
        created = j["created"].int ?? 0
        ready = j["ready"].int ?? 0
        pendingStripe = j["pending_stripe"].int ?? 0
        mailed = j["mailed"].int ?? 0
        mailError = j["mail_error"].int ?? 0
        reminded = j["reminded"].int ?? 0
        remindError = j["remind_error"].int ?? 0
        redeemed = j["redeemed"].int ?? 0
        expired = j["expired"].int ?? 0
        open = j["open"].int ?? 0
        candidates = j["candidates"].int ?? 0
        mailPending = j["mail_pending"].int ?? 0
        remindPending = j["remind_pending"].int ?? 0
        unclaimed = j["unclaimed"].int ?? 0
    }
}

/// Aantallen van lifetime_mail (lifetime-notice admin_send): dry_run, test, send, remind.
struct LifetimeMailResult {
    let noticePending, remindPending, sent, failed, retry, remaining: Int
    let remindWindow, enabled, smtp, done: Bool
    let errors: [String: Int]

    init(_ j: JSON) {
        noticePending = j["notice_pending"].int ?? 0
        remindPending = j["remind_pending"].int ?? 0
        sent = j["sent"].int ?? 0
        failed = j["failed"].int ?? 0
        retry = j["retry"].int ?? 0
        remaining = j["remaining"].int ?? 0
        remindWindow = j["remind_window"].bool ?? false
        enabled = j["enabled"].bool ?? false
        smtp = j["smtp"].bool ?? true
        done = j["done"].bool ?? true
        var e: [String: Int] = [:]
        for (k, v) in j["errors"].object ?? [:] { e[k] = v.int ?? 0 }
        errors = e
    }

    var dryText: String {
        "Droog: mail \(Fmt.num(noticePending)) te versturen, herinnering \(Fmt.num(remindPending))"
            + (remindWindow ? "" : " (alleen in de 7 dagen voor de overgang)")
            + (enabled ? "" : ". Lifetime-only staat uit: versturen kan pas als het aan staat")
            + (smtp ? "" : ". E-mail is niet ingesteld op de server") + "."
    }

    func recipientsText(_ mode: String) -> String {
        "\(Fmt.num(mode == "remind" ? remindPending : noticePending)) ontvangers"
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
        status = j["status"].text ?? "ready"
        expiresAt = j["expires_at"].date
        mailedAt = j["mailed_at"].date
        remindedAt = j["reminded_at"].date
        redeemedAt = j["redeemed_at"].date
        mailError = j["mail_error"].text
    }

    var statusText: String {
        ["ready": "klaar, nog niet gemaild", "pending_stripe": "nog niet in Stripe", "mailed": "gemaild", "mail_error": "mailfout",
         "redeemed": "gebruikt", "expired": "verlopen"][status] ?? status
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
