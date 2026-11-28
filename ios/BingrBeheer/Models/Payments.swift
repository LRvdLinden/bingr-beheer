import Foundation

/// Tab Betalingen (actie `payments_check` van de functie admin): alleen-lezen controle op misgelopen betalingen.
/// Zelfde vorm als supabase/functions/admin/payments_check.ts (buildPaymentsCheck). Nooit namen, e-mailadressen,
/// account-id's of volledige betaal-id's: alleen aantallen, bedragen, tijden en de laatste 6 tekens van een id.
struct PaymentIssue: Identifiable, Hashable {
    let key: String
    let isError: Bool
    let nl: String
    var id: String { key }

    init(_ j: JSON) {
        key = j["key"].text ?? ""
        isError = j["level"].text == "error"
        nl = j["nl"].text ?? ""
    }
}

struct PaymentDay: Identifiable, Hashable {
    let date: String
    let appleSold: Int
    let appleNew: Int
    let appleLifetime: Int
    var id: String { date }

    init(_ j: JSON) {
        date = j["date"].text ?? ""
        appleSold = j["apple_sold"].int ?? 0
        appleNew = j["apple_new"].int ?? 0
        appleLifetime = j["apple_lifetime"].int ?? 0
    }
}

struct MissingPayment: Identifiable, Hashable {
    let kind: String
    let shortID: String
    let amountCents: Int
    let paidAt: Date?
    var id: String { "\(kind)-\(shortID)" }

    init(_ j: JSON) {
        kind = j["kind"].text ?? "checkout"
        shortID = j["short_id"].text ?? ""
        amountCents = j["amount_cents"].int ?? 0
        paidAt = j["paid_at"].date
    }

    var kindText: String { kind == "invoice" ? "Abonnementsfactuur" : "Lifetime" }
}

/// Betaaltrechter (build 193): anonieme dagtelling per groep (apple, android, web) uit `funnel.days`.
struct FunnelDay: Identifiable, Hashable {
    let date: String
    let group: String
    let shown: Int
    let started: Int
    let ok: Int
    let failed: Int
    let cancelled: Int
    var id: String { "\(date)-\(group)" }

    init(_ j: JSON) {
        date = j["date"].text ?? ""
        group = j["group"].text ?? ""
        shown = j["shown"].int ?? 0
        started = j["started"].int ?? 0
        ok = j["ok"].int ?? 0
        failed = j["failed"].int ?? 0
        cancelled = j["cancelled"].int ?? 0
    }

    var isEmpty: Bool { shown == 0 && started == 0 && ok == 0 && failed == 0 && cancelled == 0 }
    var groupText: String { ["apple": "Apple", "android": "Android", "web": "Web en Windows"][group] ?? group }
    /// Gelukt als percentage van gestart ("25%"), of "—" zonder gestarte aankopen.
    var rate: String { started > 0 ? "\(Int((Double(ok) / Double(started) * 100).rounded()))%" : "—" }
}

struct FunnelError: Identifiable, Hashable {
    let error: String
    let count: Int
    var id: String { error }

    init(_ j: JSON) {
        error = j["error"].text ?? ""
        count = j["n"].int ?? 0
    }
}

struct PaymentsCheck {
    let checkedAt: Date?
    let ok: Bool
    let issues: [PaymentIssue]
    let days: [PaymentDay]
    let lastSalesDate: String?
    let unlinked7d: Int
    let unlinkedNoMail: Int
    let notifications: [(String, Int)]
    let queried: Bool
    let paidInStripe: Int?
    let recorded7d: Int
    let missing: [MissingPayment]
    let pendingOverHour: Int
    let incompleteOverDay: Int
    let pastDue: Int
    /// build 193: Lifetime via een Apple-testaankoop (sandbox). `hasSandbox` false = de server stuurt het blok nog niet mee.
    let hasSandbox: Bool
    let sandboxLifetime: Int
    let sandboxActive7d: Int
    let sandboxTemporary: Int
    /// build 193: betaaltrechter. `hasFunnel` false = de server telt nog niet.
    let hasFunnel: Bool
    let funnelDays: [FunnelDay]
    let topErrors: [FunnelError]

    init(_ j: JSON) {
        hasSandbox = j["sandbox"].object != nil
        sandboxLifetime = j["sandbox"]["lifetime_accounts"].int ?? 0
        sandboxActive7d = j["sandbox"]["active_7d"].int ?? 0
        sandboxTemporary = j["sandbox"]["temporary"].int ?? 0
        hasFunnel = j["funnel"].object != nil
        funnelDays = j["funnel"]["days"].array.map(FunnelDay.init).filter { !$0.isEmpty }
        topErrors = j["funnel"]["top_errors"].array.map(FunnelError.init).filter { !$0.error.isEmpty }
        checkedAt = j["checked_at"].date
        ok = j["verdict"].text == "ok"
        issues = j["issues"].array.map(PaymentIssue.init)
        days = j["days"].array.map(PaymentDay.init)
        lastSalesDate = j["apple"]["last_sales_date"].text
        unlinked7d = j["apple"]["unlinked_7d"].int ?? 0
        unlinkedNoMail = j["apple"]["unlinked_no_mail"].int ?? 0
        notifications = (j["apple"]["notifications_3d"].object ?? [:]).compactMap { k, v in v.int.map { (k, $0) } }.sorted { $0.0 < $1.0 }
        queried = j["stripe"]["queried"].bool ?? false
        paidInStripe = j["stripe"]["paid_in_stripe_7d"].int
        recorded7d = j["stripe"]["recorded_7d"].int ?? 0
        missing = j["stripe"]["missing"].array.map(MissingPayment.init)
        pendingOverHour = j["stripe"]["pending_over_1h"].int ?? 0
        incompleteOverDay = j["stripe"]["incomplete_over_1d"].int ?? 0
        pastDue = j["stripe"]["past_due"].int ?? 0
    }

    var hasErrors: Bool { issues.contains { $0.isError } }
}
