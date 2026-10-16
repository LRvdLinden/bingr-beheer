import Foundation
import Security

/// Gedeeld tussen de app Bingr Beheer en de widget-extensie (beide targets compileren dit bestand, zie ios/project.yml).
enum WidgetShared {
    /// Soorten widgets (WidgetKit-kinds); de app herlaadt ze na inloggen, uitloggen en het laden van support/status.
    static let statusKind = "BingrBeheerStatus"
    static let supportKind = "BingrBeheerSupport"
    static let overviewKind = "BingrBeheerOverzicht"

    /// Deeplinks (URL-schema bingrbeheer, CFBundleURLTypes in ios/project.yml; afgehandeld in Session.open).
    static let statusURL = URL(string: "bingrbeheer://status")!
    static let supportURL = URL(string: "bingrbeheer://support")!
    static let overviewURL = URL(string: "bingrbeheer://overview")!
    static let appURL = URL(string: "bingrbeheer://open")!

    /// Elke ~20 minuten een nieuwe stand (WidgetKit bepaalt zelf het precieze moment).
    static let refreshInterval: TimeInterval = 20 * 60
}

/// Widget-token van de actie `widget_token` (scope "widget", 30 dagen geldig, alleen goed voor `widget_summary`).
struct WidgetCredential: Codable, Equatable {
    let token: String
    let expiresAt: Date

    var isValid: Bool { expiresAt > Date() }
}

/// Het widget-token in de gedeelde Keychain-toegangsgroep `<AppIdentifierPrefix>nl.lrvdlinden.bingr.beheer.shared`
/// (keychain-access-groups in de entitlements van app en extensie). Alleen dit apparaat, niet in iCloud; leesbaar na de
/// eerste ontgrendeling, zodat de widget ook bijwerkt als het toestel vergrendeld is. Het gewone sessietoken (12 uur) staat
/// in de eigen groep van de app en is voor de widget niet leesbaar.
enum WidgetTokenStore {
    private static let service = "nl.lrvdlinden.bingr.beheer.widget"
    private static let account = "widget-token"
    private static let groupSuffix = "nl.lrvdlinden.bingr.beheer.shared"

    /// `$(AppIdentifierPrefix)` (Team-ID met punt) uit de Info.plist; leeg bij een build zonder ondertekening.
    static var accessGroup: String? {
        guard let p = Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String,
              !p.isEmpty, !p.contains("$(") else { return nil }
        return (p.hasSuffix(".") ? p : p + ".") + groupSuffix
    }

    private static func base() -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
        ]
        if let g = accessGroup { q[kSecAttrAccessGroup as String] = g }
        return q
    }

    static func read() -> WidgetCredential? {
        var q = base()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(WidgetCredential.self, from: data)
    }

    static func write(_ c: WidgetCredential) {
        guard let data = try? JSONEncoder().encode(c) else { return }
        delete()
        var q = base()
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    static func delete() {
        SecItemDelete(base() as CFDictionary)
    }
}
