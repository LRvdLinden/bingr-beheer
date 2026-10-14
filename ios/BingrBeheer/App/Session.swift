import Foundation
import LocalAuthentication
import Observation
import SwiftUI

/// Onderdelen van het beheer (tabs van web/index.html) plus Instellingen.
enum AppSection: String, CaseIterable, Identifiable, Hashable {
    case overview, users, support, messages, status, settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: return "Overzicht"
        case .users: return "Gebruikers"
        case .support: return "Support"
        case .messages: return "Berichten"
        case .status: return "Status"
        case .settings: return "Instellingen"
        }
    }

    var icon: String {
        switch self {
        case .overview: return "chart.bar.xaxis"
        case .users: return "person.2"
        case .support: return "lifepreserver"
        case .messages: return "megaphone"
        case .status: return "waveform.path.ecg"
        case .settings: return "gearshape"
        }
    }
}

struct Toast: Equatable {
    let id = UUID()
    let text: String
    let bad: Bool
}

/// Voortgang van het e-mailen van een bericht (blijft lopen als je van tab wisselt).
struct MailProgress: Equatable {
    var announcementID: String
    var total: Int
    var sent = 0
    var failed = 0
    var done = false

    var fraction: Double {
        total > 0 ? min(1, Double(sent + failed) / Double(total)) : (done ? 1 : 0)
    }

    var text: String {
        var s = "\(Fmt.num(sent)) verstuurd"
        if failed > 0 { s += ", \(Fmt.num(failed)) mislukt" }
        return s + " van \(Fmt.num(total))" + (done ? " · klaar" : "…")
    }
}

/// Inlogsessie, vergrendeling en gedeelde toestand van de app.
@MainActor
@Observable
final class Session {
    // inloggen (token 12 uur geldig, in de Keychain)
    private(set) var token: String?
    private(set) var expiresAt: Date?
    var loginMessage: String?

    // vergrendeling met Face ID / Touch ID / toegangscode
    // (de schakelaar staat in Instellingen als @AppStorage("lockEnabled"))
    var lockEnabled: Bool { UserDefaults.standard.bool(forKey: "lockEnabled") }
    var isLocked = false
    /// Face ID één keer vanzelf vragen per vergrendeling (niet opnieuw na annuleren)
    @ObservationIgnored var autoUnlockTried = false

    // navigatie
    var section: AppSection = .overview
    var supportPath: [Int] = []

    // support-tellers (badge op de tab, tegel in Overzicht)
    var supportCounts: SupportCounts?

    // berichten
    var mailProgress: MailProgress?
    var announcementsVersion = 0

    var toast: Toast?

    @ObservationIgnored private let api = AdminAPI()
    @ObservationIgnored private var countsTask: Task<Void, Never>?
    private static let keychainAccount = "session"

    var isSignedIn: Bool { token != nil }

    init() {
        if let data = Keychain.read(Self.keychainAccount),
           let s = try? JSONDecoder().decode(JSON.self, from: data),
           let t = s["token"].text, let exp = s["expires_at"].date, exp > Date() {
            token = t
            expiresAt = exp
        } else {
            Keychain.delete(Self.keychainAccount)
        }
        isLocked = lockEnabled
        if isSignedIn { startCountsPolling() }
    }

    // MARK: inloggen

    func login(user: String, password: String) async throws {
        let r = try await api.send("login", token: nil, params: ["user": user, "password": password])
        guard let t = r["token"].text else { throw APIError(code: "server_error", status: 200, body: r) }
        let exp = r["expires_at"].date ?? Date().addingTimeInterval(12 * 3600)
        let blob: [String: String] = ["token": t, "expires_at": r["expires_at"].text ?? ISO8601DateFormatter().string(from: exp)]
        if let data = try? JSONSerialization.data(withJSONObject: blob) { Keychain.write(Self.keychainAccount, data) }
        token = t
        expiresAt = exp
        loginMessage = nil
        isLocked = false
        startCountsPolling()
    }

    func logout(_ message: String? = nil) {
        Keychain.delete(Self.keychainAccount)
        token = nil
        expiresAt = nil
        loginMessage = message
        supportCounts = nil
        supportPath = []
        mailProgress = nil
        countsTask?.cancel()
        countsTask = nil
    }

    /// Roept een actie van de functie `admin` aan met het token. 401: sessie verlopen, terug naar inloggen.
    @discardableResult
    func call(_ action: String, _ params: [String: Any?] = [:]) async throws -> JSON {
        if let exp = expiresAt, exp <= Date() {
            logout("Je sessie is verlopen. Log opnieuw in.")
            throw APIError(code: "auth", status: 401, body: .null)
        }
        do {
            return try await api.send(action, token: token, params: params)
        } catch let e as APIError where e.status == 401 {
            logout("Je sessie is verlopen. Log opnieuw in.")
            throw APIError(code: "auth", status: 401, body: e.body)
        }
    }

    // MARK: meldingen

    func show(_ text: String, bad: Bool = false) {
        toast = Toast(text: text, bad: bad)
    }

    /// Toont een fout als melding (behalve een verlopen sessie of geannuleerde taak).
    func report(_ error: Error) {
        if error is CancellationError { return }
        if let e = error as? APIError {
            if e.code == "auth" { return }
            show(e.errorDescription ?? APIError.text("server_error"), bad: true)
        } else {
            show(APIError.text("server_error"), bad: true)
        }
    }

    // MARK: support-tellers (elke 2 minuten, zoals het web-dashboard)

    func refreshSupportCounts() async {
        guard isSignedIn else { return }
        if let r = try? await call("support_counts") { supportCounts = SupportCounts(r) }
    }

    private func startCountsPolling() {
        countsTask?.cancel()
        countsTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refreshSupportCounts()
                try? await Task.sleep(for: .seconds(120))
            }
        }
    }

    // MARK: deep links

    /// bingrbeheer://support/1001 of https://beheer.bingr.online/#support/1001
    func open(_ url: URL) {
        let text = url.absoluteString
        guard let r = text.range(of: #"support/?(\d+)?$"#, options: .regularExpression) else { return }
        section = .support
        let digits = text[r].filter(\.isNumber)
        if let n = Int(digits), n > 0 { supportPath = [n] }
    }

    // MARK: vergrendelen

    var biometryName: String {
        let ctx = LAContext()
        _ = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch ctx.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return "toegangscode"
        }
    }

    var canLock: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    func unlock() async {
        let ctx = LAContext()
        ctx.localizedCancelTitle = "Annuleren"
        do {
            if try await ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Ontgrendel Bingr Beheer") {
                isLocked = false
            }
        } catch {
            // geannuleerd of mislukt: vergrendeld laten
        }
    }

    func didEnterBackground() {
        if lockEnabled && isSignedIn {
            isLocked = true
            autoUnlockTried = false
        }
    }
}
