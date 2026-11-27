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

    init(_ j: JSON) {
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
