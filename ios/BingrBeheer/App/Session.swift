import Foundation
import LocalAuthentication
import Observation
import SwiftUI
import WidgetKit

/// Onderdelen van het beheer (tabs van web/index.html) plus Instellingen.
enum AppSection: String, CaseIterable, Identifiable, Hashable {
    case overview, insights, users, support, messages, newsletter, status, downloads, settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: return "Overzicht"
        case .insights: return "Insights"
        case .users: return "Gebruikers"
        case .support: return "Support"
        case .messages: return "Pushmeldingen"
        case .newsletter: return "Nieuwsbrief"
        case .status: return "Status"
        case .downloads: return "Downloads"
        case .settings: return "Instellingen"
        }
    }

    var icon: String {
        switch self {
        case .overview: return "square.grid.2x2"
        case .insights: return "chart.xyaxis.line"
        case .users: return "person.2"
        case .support: return "lifepreserver"
        case .messages: return "bell.badge"
        case .newsletter: return "envelope.badge"
        case .status: return "waveform.path.ecg"
        case .downloads: return "arrow.down.circle"
        case .settings: return "gearshape"
        }
    }
}

struct Toast: Equatable {
    let id = UUID()
    let text: String
    let bad: Bool
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
    /// Filter van de tab Gebruikers ("" = alle, "blocked" = geblokkeerd); de tegel in Overzicht zet hem.
    var usersFilter = ""
    /// Wordt opgehoogd na blokkeren, opheffen of verwijderen: lijst en tellers laden opnieuw.
    var usersRevision = 0

    // support-tellers (badge op de tab, tegel in Overzicht)
    var supportCounts: SupportCounts?

    // pushmeldingen (tab messages)
    /// Voortgang van de laatst verstuurde pushmelding (push_progress tot done).
    var pushProgress: PushProgress?
    /// Wordt opgehoogd na versturen: de geschiedenis laadt opnieuw.
    var pushVersion = 0

    var toast: Toast?

    /// Vernieuwen via ⌘R, het menu Beheer of de knop in de werkbalk (Mac): elke ophoging laat de zichtbare onderdelen
    /// opnieuw laden (`refreshableCommand` in Components.swift). Trekken om te vernieuwen bestaat op de Mac niet.
    var refreshRequest = 0

    @ObservationIgnored private let api = AdminAPI()
    @ObservationIgnored private var countsTask: Task<Void, Never>?
    /// Mac: sinds wanneer de app niet voorop staat (voor vergrendelen na `macInactiveLock`).
    @ObservationIgnored private var inactiveSince: Date?
    /// Laatste poging om een widget-token op te halen (hoogstens één per uur, behalve na inloggen).
    @ObservationIgnored private var widgetTokenTriedAt: Date?
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
        // build 97: vergrendelen staat standaard aan bij de eerste keer inloggen (als het apparaat een toegangscode heeft);
        // zet je hem zelf uit in Instellingen, dan blijft hij uit
        if UserDefaults.standard.object(forKey: "lockEnabled") == nil && canLock {
            UserDefaults.standard.set(true, forKey: "lockEnabled")
        }
        startCountsPolling()
        // widgets: meteen een nieuw widget-token (30 dagen), daarna herladen de widgets
        Task { await refreshWidgetToken(force: true) }
        // pushmeldingen: opnieuw aanmelden en (eenmalig, op een rustig moment) om toestemming vragen
        PushService.shared.didSignIn()
    }

    /// build 97: overal uitloggen (actie logout_all): alle beheer-tokens vervallen, ook op het web en andere apparaten.
    func logoutAll() async throws {
        try await call("logout_all")
        logout("Je bent overal uitgelogd.")
    }

    /// Uitloggen. `clearWidgets` false alleen als de sessie (12 uur) vanzelf verloopt: het widget-token (30 dagen) blijft
    /// dan werken. Zelf uitloggen of overal uitloggen wist het widget-token (overal uitloggen trekt het op de server ook in).
    /// Zelf uitloggen meldt ook de pushmeldingen van dit apparaat af (admin_push_unregister, met het token dat net eindigt);
    /// verloopt alleen de sessie, dan blijven ze aan tot je opnieuw inlogt (zoals de widgets).
    func logout(_ message: String? = nil, clearWidgets: Bool = true) {
        if clearWidgets {
            WidgetTokenStore.delete()
            widgetTokenTriedAt = nil
            PushService.shared.signOut(token: token)
        }
        WidgetCenter.shared.reloadAllTimelines()
        Keychain.delete(Self.keychainAccount)
        token = nil
        expiresAt = nil
        loginMessage = message
        supportCounts = nil
        supportPath = []
        pushProgress = nil
        countsTask?.cancel()
        countsTask = nil
    }

    /// Roept een actie van de functie `admin` aan met het token. 401: sessie verlopen, terug naar inloggen.
    @discardableResult
    func call(_ action: String, _ params: [String: Any?] = [:]) async throws -> JSON {
        if let exp = expiresAt, exp <= Date() {
            logout("Je sessie is verlopen. Log opnieuw in.", clearWidgets: false)
            throw APIError(code: "auth", status: 401, body: .null)
        }
        do {
            return try await api.send(action, token: token, params: params)
        } catch let e as APIError where e.status == 401 {
            // ingetrokken (overal uitloggen elders, ander wachtwoord) of verlopen; is het widget-token ook ingetrokken,
            // dan meldt de widget zelf "Open BingrBeheer om in te loggen"
            logout("Je sessie is verlopen. Log opnieuw in.", clearWidgets: false)
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

    // MARK: vernieuwen (⌘R)

    func requestRefresh() {
        guard isSignedIn, !isLocked else { return }
        refreshRequest &+= 1
        Task { await refreshSupportCounts() }
    }

    // MARK: support-tellers (elke 2 minuten, zoals het web-dashboard)

    func refreshSupportCounts() async {
        guard isSignedIn else { return }
        if let r = try? await call("support_counts") {
            let counts = SupportCounts(r)
            if counts != supportCounts {
                supportCounts = counts
                reloadWidgets(WidgetShared.supportKind)
            }
        }
        await refreshWidgetToken()
    }

    // MARK: widgets

    /// Widgets aan (standaard) of uit (Instellingen). Uit: geen widget-token op dit apparaat, de widgets vragen om in te loggen.
    var widgetsEnabled: Bool { UserDefaults.standard.object(forKey: "widgetsEnabled") as? Bool ?? true }

    func setWidgetsEnabled(_ on: Bool) async {
        UserDefaults.standard.set(on, forKey: "widgetsEnabled")
        if on {
            await refreshWidgetToken(force: true)
        } else {
            WidgetTokenStore.delete()
            widgetTokenTriedAt = nil
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    /// Haalt een widget-token op (actie widget_token, alleen met de gewone sessie). Zonder `force` alleen als het bewaarde
    /// token ouder is dan een dag (of ontbreekt), en hoogstens één poging per uur.
    func refreshWidgetToken(force: Bool = false) async {
        guard isSignedIn, widgetsEnabled else { return }
        if !force {
            if let c = WidgetTokenStore.read(), c.expiresAt.timeIntervalSinceNow > 29 * 86400 { return }
            if let t = widgetTokenTriedAt, Date().timeIntervalSince(t) < 3600 { return }
        }
        widgetTokenTriedAt = Date()
        do {
            let r = try await call("widget_token")
            guard let t = r["widget_token"].text, let exp = r["expires_at"].date else { return }
            WidgetTokenStore.write(WidgetCredential(token: t, expiresAt: exp))
            WidgetCenter.shared.reloadAllTimelines()
        } catch {
            // geen verbinding of een oudere server: de widgets houden het oude token of vragen om in te loggen
        }
    }

    /// Widgets bijwerken na het laden van support of status (alleen die soort en de gecombineerde widget).
    func reloadWidgets(_ kind: String) {
        WidgetCenter.shared.reloadTimelines(ofKind: kind)
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetShared.overviewKind)
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

    /// bingrbeheer://support/1001 of https://beheer.bingr.online/#support/1001; uit de widgets en pushmeldingen ook
    /// bingrbeheer://support, bingrbeheer://status, bingrbeheer://downloads en bingrbeheer://overview (die tab openen;
    /// Downloads op de iPhone als blad, zie TabLayout).
    func open(_ url: URL) {
        if url.scheme?.lowercased() == "bingrbeheer" {
            switch url.host?.lowercased() {
            case "status": section = .status; return
            case "overview": section = .overview; return
            case "insights": section = .insights; return
            case "downloads": section = .downloads; return
            case "newsletter": section = .newsletter; return
            default: break
            }
        }
        let text = url.absoluteString
        guard let r = text.range(of: #"support/?(\d+)?$"#, options: .regularExpression) else { return }
        section = .support
        let digits = text[r].filter(\.isNumber)
        if let n = Int(digits), n > 0 { supportPath = [n] } else { supportPath = [] }
    }

    // MARK: vergrendelen

    var biometryName: String {
        let ctx = LAContext()
        _ = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch ctx.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return Platform.isMac ? "wachtwoord" : "toegangscode"
        }
    }

    /// SF Symbol bij `biometryName` (vergrendelscherm, Instellingen).
    var biometryIcon: String {
        switch biometryName {
        case "Face ID": return "faceid"
        case "Touch ID": return "touchid"
        case "Optic ID": return "opticid"
        default: return "lock"
        }
    }

    var canLock: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    func unlock() async {
        let ctx = LAContext()
        ctx.localizedCancelTitle = "Annuleren"
        do {
            if try await ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Ontgrendel BingrBeheer") {
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

    /// Mac: het venster staat niet meer voorop (ander programma actief). Geen afscherming zoals in de app-wisselaar van iOS
    /// (dan zou het venster bij elke klik ernaast leeg worden), wel vergrendelen na een tijd weg (zie `didBecomeActive`).
    /// Geminimaliseerd of verborgen (⌘H) = achtergrond: dan meteen vergrendelen (`didEnterBackground`).
    func didResignActive() {
        if inactiveSince == nil { inactiveSince = Date() }
    }

    /// Mac: weer voorop; na meer dan `macInactiveLock` weg vergrendelen.
    func didBecomeActive() {
        defer { inactiveSince = nil }
        guard let since = inactiveSince, lockEnabled, isSignedIn, !isLocked else { return }
        if Date().timeIntervalSince(since) > Self.macInactiveLock {
            isLocked = true
            autoUnlockTried = false
        }
    }

    /// Mac: vergrendelen na 5 minuten niet voorop.
    static let macInactiveLock: TimeInterval = 5 * 60
}
