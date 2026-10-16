import Foundation

/// Bericht uit `announcements_list`: e-mails en de oude berichten (in-app banner, vervallen sinds de pushmeldingen).
struct Announcement: Identifiable {
    let id: String
    let titleNl: String
    let bodyNl: String
    let titleEn: String?
    let bodyEn: String?
    let createdAt: Date?
    let expiresAt: Date?
    let email: Bool
    let emailTotal: Int
    let emailSent: Int
    let emailFailed: Int
    let emailDoneAt: Date?
    let active: Bool
    /// Sinds de pushmeldingen: alleen per e-mail (nooit als in-app banner getoond).
    let mailOnly: Bool

    init(_ j: JSON) {
        id = j["id"].text ?? UUID().uuidString
        titleNl = j["title_nl"].text ?? ""
        bodyNl = j["body_nl"].text ?? ""
        titleEn = j["title_en"].text
        bodyEn = j["body_en"].text
        createdAt = j["created_at"].date
        expiresAt = j["expires_at"].date
        email = j["email"].bool ?? false
        emailTotal = j["email_total"].int ?? 0
        emailSent = j["email_sent"].int ?? 0
        emailFailed = j["email_failed"].int ?? 0
        emailDoneAt = j["email_done_at"].date
        active = j["active"].bool ?? false
        mailOnly = j["mail_only"].bool ?? false
    }

    /// E-mail gestart maar nog niet afgerond: "Verder verzenden".
    var canResume: Bool { email && emailDoneAt == nil }
}
