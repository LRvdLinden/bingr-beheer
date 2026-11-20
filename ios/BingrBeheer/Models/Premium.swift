import Foundation

/// Build 181: Bingr Premium. Zelfde contract als supabase/functions/admin/premium.ts en de tab Premium van het web-dashboard
/// (acties premium_settings, premium_stats, premium_setup, premium_test, premium_mailing). Alleen instellingen en totalen.
struct PremiumSettings: Equatable {
    var enabled = false
    var newFromWeb: Date?
    var newFromApple: Date?
    var existingFrom: Date?
    var trialDays = 3
    var showPricesWeb = false
    var graceDays = 3
    var prices: [String: Int] = PremiumSettings.defaultPrices
    var testUsers: [String] = []

    static let plans = ["month", "half", "year", "lifetime"]
    static let defaultPrices: [String: Int] = ["month": 499, "half": 1999, "year": 2999, "lifetime": 4999]
    static let planNames: [String: String] = ["month": "Maand", "half": "Halfjaar", "year": "Jaar", "lifetime": "Lifetime"]
    static let priceLabels: [String: String] = ["month": "Maandelijks", "half": "Halfjaarlijks", "year": "Jaarlijks", "lifetime": "Lifetime"]

    init() {}

    init(_ j: JSON) {
        enabled = j["enabled"].bool ?? false
        newFromWeb = j["new_from_web"].date
        newFromApple = j["new_from_apple"].date
        existingFrom = j["existing_from"].date
        trialDays = j["trial_days"].int ?? 3
        showPricesWeb = j["show_prices_web"].bool ?? false
        graceDays = j["grace_days"].int ?? 3
        var p = Self.defaultPrices
        for k in Self.plans {
            if let v = j["prices"][k].int { p[k] = v }
        }
        prices = p
        testUsers = j["test_users"].strings
    }

    func price(_ plan: String) -> Int { prices[plan] ?? Self.defaultPrices[plan] ?? 0 }

    /// Body van premium_settings {set: …} (zonder test_users en Stripe-id's: die hebben eigen acties).
    var payload: [String: Any] {
        var p: [String: Int] = [:]
        for k in Self.plans { p[k] = price(k) }
        let s: [String: Any] = [
            "enabled": enabled, "show_prices_web": showPricesWeb,
            "new_from_web": LifetimeSettings.iso(newFromWeb), "new_from_apple": LifetimeSettings.iso(newFromApple),
            "existing_from": LifetimeSettings.iso(existingFrom),
            "trial_days": trialDays, "grace_days": graceDays, "prices": p,
        ]
        return s
    }

    /// Uitleg per bevestigingssleutel (409 confirm_required), zelfde teksten als PM_CONFIRM in web/admin.js.
    static let confirmText: [String: String] = [
        "enable": "Premium gaat AAN (hoofdschakelaar). Dat doet pas iets met een datum voor web en Android of Apple, of voor testaccounts.",
        "new_from_web": "Nieuwe accounts op web, Windows, Android en Android TV moeten vanaf deze datum een plan kiezen (met proef).",
        "new_from_apple": "Nieuwe accounts in de Apple-apps moeten vanaf deze datum een plan kiezen. Alleen doen na de goedkeuring van Apple.",
        "existing_from": "Het moment waarop bestaande gratis accounts een plan moeten kiezen verandert.",
        "show_prices": "De nieuwe prijzen worden zichtbaar op bingr.online en /upgrade/.",
        "prices": "De prijzen veranderen. Maak daarna opnieuw de Stripe-producten aan; lopende abonnementen houden hun prijs.",
        "trial": "De proef voor nieuwe accounts verandert terwijl Premium aan staat.",
        "setup": "Producten, prijzen en de Customer Portal echt aanmaken in Stripe.",
    ]

    /// Waarschuwingen (premium.ts warnings), zelfde teksten als PM_WARN in web/admin.js.
    static let warningText: [String: String] = [
        "stripe_not_ready": "De Stripe-prijzen van de huidige modus ontbreken: niemand kan afrekenen. Eerst “Stripe-producten aanmaken”.",
        "apple_before_web": "Apple doet eerder mee dan web en Android.",
        "existing_before_new": "Bestaande accounts moeten eerder kiezen dan de datum voor nieuwe accounts.",
        "dates_without_enabled": "Er staan datums, maar de hoofdschakelaar staat uit: ze doen nu niets.",
        "test_users": "Er staan testaccounts aan: die zien Premium al.",
    ]

    static func warningMessage(_ keys: [String]) -> String {
        keys.map { warningText[$0] ?? $0 }.joined(separator: "\n")
    }

    static func confirmMessage(_ keys: [String]) -> String {
        keys.map { "• " + (confirmText[$0] ?? $0) }.joined(separator: "\n")
    }
}

/// Antwoord van premium_settings: instellingen, wat er nu geldt, de Stripe-modus en waarschuwingen.
struct PremiumState {
    let settings: PremiumSettings
    let web: Bool
    let apple: Bool
    let existing: Bool
    let testCount: Int
    let mode: String?
    let warnings: [String]

    init(_ j: JSON) {
        settings = PremiumSettings(j["settings"])
        web = j["phase"]["web"].bool ?? false
        apple = j["phase"]["apple"].bool ?? false
        existing = j["phase"]["existing"].bool ?? false
        testCount = j["phase"]["test"].int ?? 0
        mode = j["mode"].text
        warnings = j["warnings"].strings
    }

    /// Stand als chip: tekst en toon (zoals de chip in loadPremium).
    var chip: (String, Tone) {
        if web || apple { return existing ? ("Aan, ook voor bestaande accounts", .bad) : ("Aan voor nieuwe accounts", .warn) }
        return settings.enabled ? ("Aan, nog geen groep", .warn) : ("Uit", .neutral)
    }

    func when(_ d: Date?) -> String {
        guard let d else { return "uit" }
        let now: Bool = d <= Date()
        return Fmt.dateTimeNL(d) + (now ? " (geldt nu)" : "")
    }

    var trialText: String {
        let n = settings.trialDays
        return n > 0 ? "\(n) dagen" : "geen"
    }
}

/// Eén regel van premium_stats.by (per aanbieder en plan).
struct PremiumByRow: Identifiable {
    let provider: String
    let plan: String
    let active: Int
    let trialing: Int
    let canceled: Int
    let mrr: Int
    var id: String { provider + "-" + plan }

    init(_ j: JSON) {
        provider = j["provider"].text == "apple" ? "apple" : "stripe"
        plan = j["plan"].text ?? "?"
        active = j["active"].int ?? 0
        trialing = j["trialing"].int ?? 0
        canceled = j["canceled"].int ?? 0
        mrr = j["mrr_cents"].int ?? 0
    }

    var title: String {
        let p: String = provider == "apple" ? "Apple" : "Stripe"
        let n: String = PremiumSettings.planNames[plan] ?? plan
        return p + " · " + n
    }

    var detail: String {
        let a: String = Fmt.num(active) + " actief"
        let t: String = Fmt.num(trialing) + " proef"
        let c: String = Fmt.num(canceled) + " opgezegd"
        return a + " · " + t + " · " + c + " · " + Fmt.euro(mrr) + " MRR"
    }
}

/// Totalen van premium_stats; ontbrekende velden = 0 (zoals pmStatsNorm in web/admin.js).
struct PremiumStats {
    let active, trialing, pastDue, canceled, expired30d, mrr, trialsStarted, trialsConverted, unclaimed: Int
    let lifetimeCount, lifetimeGross: Int
    let liveCount, liveGross, liveRefunded: Int
    let by: [PremiumByRow]
    /// Stripe-abonnementen per maand (alleen live): "2026-12 € 4,99 (1)".
    let monthly: [String]

    init(_ j: JSON) {
        active = j["active"].int ?? 0
        trialing = j["trialing"].int ?? 0
        pastDue = j["past_due"].int ?? 0
        canceled = j["canceled"].int ?? 0
        expired30d = j["expired_30d"].int ?? 0
        mrr = j["mrr_cents"].int ?? 0
        trialsStarted = j["trials_started"].int ?? 0
        trialsConverted = j["trials_converted"].int ?? 0
        unclaimed = j["unclaimed"].int ?? 0
        lifetimeCount = j["lifetime49"]["count"].int ?? 0
        lifetimeGross = j["lifetime49"]["gross"].int ?? 0
        let live = j["stripe_revenue"]["live"]
        liveCount = live["count"].int ?? 0
        liveGross = live["gross"].int ?? 0
        liveRefunded = live["refunded"].int ?? 0
        by = j["by"].array.map(PremiumByRow.init)
        monthly = j["monthly"].array.filter { $0["mode"].text == "live" }.map(Self.monthText)
    }

    private static func monthText(_ m: JSON) -> String {
        let month: String = m["month"].text ?? "?"
        let net: Int = (m["gross"].int ?? 0) - (m["refunded"].int ?? 0)
        let n: Int = m["count"].int ?? 0
        return month + " " + Fmt.euro(net) + " (" + Fmt.num(n) + ")"
    }

    /// Actief, in proef en MRR van één aanbieder (stripe / apple).
    func provider(_ p: String) -> (active: Int, trialing: Int, mrr: Int) {
        var a = 0, t = 0, m = 0
        for r in by where r.provider == p {
            a += r.active
            t += r.trialing
            m += r.mrr
        }
        return (a, t, m)
    }

    var conversionText: String {
        guard trialsStarted > 0 else { return "" }
        let pct: Int = Int((Double(trialsConverted) / Double(trialsStarted) * 100).rounded())
        return "\(pct)% omgezet"
    }

    var liveNet: Int { liveGross - liveRefunded }
}

/// Antwoord van premium_setup (droog of echt): alleen Stripe-id's, als één regel tekst.
struct PremiumSetupResult {
    let dryRun: Bool
    let mode: String?
    let products: Int
    let prices: Int
    let portal: Bool
    let created: [String]

    init(_ j: JSON) {
        dryRun = j["dry_run"].bool ?? false
        mode = j["mode"].text
        let pr = j["products"]
        products = [pr["sub"].text, pr["lifetime"].text].compactMap { $0 }.count
        prices = PremiumSettings.plans.filter { j["prices"][$0].text != nil }.count
        portal = j["portal"].text != nil
        created = j["created"].strings
    }

    var text: String {
        let head: String = (dryRun ? "Droog" : "Klaar") + " (Stripe " + (mode ?? "?") + ")"
        let body: String = ": producten \(products)/2, prijzen \(prices)/4, portal " + (portal ? "ja" : "nee")
        let made: String = created.isEmpty ? "" : " · aangemaakt: " + created.joined(separator: ", ")
        return head + body + made + "."
    }
}

/// Concept-mailing voor bestaande gratis accounts (premium_mailing); wordt nooit vanuit hier verstuurd.
struct PremiumMailing {
    struct Lang {
        let subject: String
        let body: String
        let button: String
    }
    let nl: Lang
    let en: Lang
    let url: String

    init(_ j: JSON) {
        func lang(_ x: JSON) -> Lang { Lang(subject: x["subject"].text ?? "", body: x["body"].string ?? "", button: x["button"].text ?? "") }
        nl = lang(j["nl"])
        en = lang(j["en"])
        url = j["url"].text ?? "https://bingr.online/upgrade/"
    }

    /// Als concept in Eigen mailing (Servicebericht); MailingView laadt het bij het openen.
    func saveAsDraft() {
        var d = MailingDraft()
        d.audience = MailingAudience.service.rawValue
        d.subjectNl = nl.subject
        d.bodyNl = nl.body
        d.buttonNl = nl.button
        d.subjectEn = en.subject
        d.bodyEn = en.body
        d.buttonEn = en.button
        d.buttonURL = url
        d.save()
    }
}
