import Foundation

/// Tab Verzonden (actie `mail_log` van de functie admin): het verzendlogboek van de mails die de functies versturen.
/// Zelfde vorm als supabase/functions/admin/mail_log.ts (mailLogView). Nooit de inhoud van de mail; nieuwsbrief en mailings staan er niet in.
struct MailLogItem: Identifiable, Hashable {
    let id: Int
    let at: Date?
    let source: String
    let to: String
    let subject: String
    let ok: Bool
    let error: String

    init(_ j: JSON) {
        id = j["id"].int ?? 0
        at = j["at"].date
        source = j["source"].text ?? ""
        to = j["to"].text ?? ""
        subject = j["subject"].text ?? ""
        ok = j["ok"].bool ?? false
        error = j["error"].text ?? ""
    }

    var resultText: String { ok ? "Aangenomen" : (error.isEmpty ? "Mislukt" : "Mislukt (\(error))") }
}

struct MailLog {
    let items: [MailLogItem]
    let sources: [String]
    let total7d: Int
    let failed7d: Int

    init(_ j: JSON) {
        items = j["items"].array.map(MailLogItem.init)
        sources = j["sources"].strings
        total7d = j["totals"]["total_7d"].int ?? 0
        failed7d = j["totals"]["failed_7d"].int ?? 0
    }

    /// Leesbare naam van een bron.
    static func sourceText(_ s: String) -> String {
        ["support": "Support", "status": "Status", "auth": "Account", "stripe": "Stripe", "beheer": "Beheer",
         "lifetime": "Lifetime", "overig": "Overig"][s] ?? s
    }
}
