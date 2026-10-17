import Foundation
import Observation
import SwiftUI
import UIKit
import UserNotifications

/// Welke meldingen dit apparaat wil (prefs in admin_push_devices; de cron van de functie `push` houdt zich eraan).
struct PushPrefs: Codable, Equatable {
    var tickets = true
    var replies = true
    var builds = true
    var status = true

    var params: [String: Bool] { ["tickets": tickets, "replies": replies, "builds": builds, "status": status] }
}

/// Systeem-pushmeldingen van BingrBeheer (APNs, topic nl.lrvdlinden.bingr.beheer) op iPhone, iPad en Mac (Catalyst).
///
/// - Toestemming pas na het inloggen, op een rustig moment (`showPrompt`, eenmalig), of via Instellingen.
/// - Het APNs-devicetoken (hex) gaat met `admin_push_register` naar de functie `admin` (tabel admin_push_devices), opnieuw
///   bij een nieuwe token, build, omgeving of platform; schakelaars per soort via `admin_push_prefs`.
/// - Uitloggen meldt dit apparaat af (`admin_push_unregister`); Overal uitloggen maakt de tabel op de server leeg.
/// - Tikken op een melding opent `url` (bingrbeheer://support/1001, ://downloads, ://status) via `Session.open`.
@MainActor
@Observable
final class PushService {
    static let shared = PushService()

    /// Toestemming in de systeeminstellingen.
    enum Permission: Equatable { case unknown, notDetermined, denied, allowed }

    private(set) var permission: Permission = .unknown
    /// Aangemeld bij de server (laatste registratie gelukt en nog geldig voor dit token).
    private(set) var registered = false
    /// Laatste fout bij aanmelden (korte tekst voor Instellingen), of nil.
    private(set) var lastError: String?
    /// Uitleg vóór de systeemvraag (eenmalig na het inloggen).
    var showPrompt = false
    private(set) var prefs: PushPrefs

    @ObservationIgnored private weak var session: Session?
    @ObservationIgnored private var pendingURL: URL?
    @ObservationIgnored private var syncTask: Task<Void, Never>?
    @ObservationIgnored private var resync = false
    @ObservationIgnored private let defaults = UserDefaults.standard

    private enum K {
        static let deviceID = "push.device_id"
        static let token = "push.token"
        static let prefs = "push.prefs"
        /// Wat de server het laatst aannam: token|platform|build|omgeving (zonder prefs).
        static let registration = "push.registration"
        /// De prefs die de server het laatst aannam.
        static let sentPrefs = "push.sent_prefs"
        static let prompted = "push.prompted"
    }

    private init() {
        if let data = UserDefaults.standard.data(forKey: K.prefs), let p = try? JSONDecoder().decode(PushPrefs.self, from: data) {
            prefs = p
        } else {
            prefs = PushPrefs()
        }
        registered = UserDefaults.standard.string(forKey: K.registration) != nil
    }

    // MARK: apparaat

    /// Willekeurige id van dit apparaat (één keer gemaakt; geen hardware-id).
    var deviceID: String {
        if let id = defaults.string(forKey: K.deviceID), id.count >= 8 { return id }
        let id = UUID().uuidString
        defaults.set(id, forKey: K.deviceID)
        return id
    }

    private var apnsToken: String? {
        get { defaults.string(forKey: K.token) }
        set { defaults.set(newValue, forKey: K.token) }
    }

    /// ios, ipados of macos (Mac Catalyst).
    static var platform: String {
        #if targetEnvironment(macCatalyst)
        return "macos"
        #else
        return UIDevice.current.userInterfaceIdiom == .pad ? "ipados" : "ios"
        #endif
    }

    static var appBuild: Int { Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") ?? 0 }

    /// APNs-omgeving: sandbox voor debug-builds en alles met een ontwikkelprofiel; productie voor TestFlight en App Store.
    static let sandbox: Bool = {
        #if DEBUG
        return true
        #else
        return ProvisioningProfile.apsEnvironment == "development"
        #endif
    }()

    // MARK: starten

    /// Vanuit de app (RootView): sessie koppelen, toestemming lezen en (als het mag) opnieuw registreren bij APNs.
    func attach(_ session: Session) {
        self.session = session
        if let url = pendingURL {
            pendingURL = nil
            session.open(url)
        }
        Task { await refresh() }
    }

    /// Toestemming opnieuw lezen (bij openen en na terugkeer uit de systeeminstellingen). Apple raadt aan bij elke start
    /// opnieuw te registreren; dan komt een eventueel nieuwe token binnen.
    func refresh() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined: permission = .notDetermined
        case .denied: permission = .denied
        // authorized, provisional (en ephemeral, alleen App Clips)
        default: permission = .allowed
        }
        guard session?.isSignedIn == true else { return }
        if permission == .allowed {
            UIApplication.shared.registerForRemoteNotifications()
            sync()
        } else if permission == .denied && registered {
            // toestemming ingetrokken: afmelden
            await unregister()
        }
    }

    /// Na inloggen: opnieuw aanmelden, en op een rustig moment (na een paar seconden) eenmalig de uitleg tonen.
    func didSignIn() {
        defaults.removeObject(forKey: K.registration)
        registered = false
        Task {
            await refresh()
            try? await Task.sleep(for: .seconds(4))
            guard session?.isSignedIn == true, session?.isLocked == false, permission == .notDetermined,
                  !defaults.bool(forKey: K.prompted) else { return }
            showPrompt = true
        }
    }

    /// Antwoord op de uitleg: "Aanzetten" vraagt de systeemtoestemming, "Niet nu" niets (kan later via Instellingen).
    func answerPrompt(_ yes: Bool) {
        defaults.set(true, forKey: K.prompted)
        showPrompt = false
        if yes { Task { await requestPermission() } }
    }

    /// Systeemvraag (alleen als het systeem nog niets gevraagd heeft; anders naar de systeeminstellingen).
    func requestPermission() async {
        defaults.set(true, forKey: K.prompted)
        if permission == .denied {
            openSystemSettings()
            return
        }
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        await refresh()
    }

    func openSystemSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }

    // MARK: APNs

    func didRegister(deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        if hex != apnsToken {
            apnsToken = hex
            defaults.removeObject(forKey: K.registration)
            registered = false
        }
        sync()
    }

    func didFailToRegister() {
        lastError = "Apple gaf geen pushtoken (Push Notifications staat misschien niet aan voor deze app-id of dit profiel)."
    }

    // MARK: server

    private var signature: String? {
        guard let t = apnsToken else { return nil }
        return [t, Self.platform, String(Self.appBuild), Self.sandbox ? "sandbox" : "production"].joined(separator: "|")
    }

    /// Aanmelden (of alleen de prefs bijwerken) als er iets veranderd is. Eén tegelijk; een verzoek tussendoor volgt erna.
    func sync() {
        guard syncTask == nil else { resync = true; return }
        syncTask = Task {
            repeat {
                resync = false
                await performSync()
            } while resync
            syncTask = nil
        }
    }

    private func performSync() async {
        guard let session, session.isSignedIn, permission == .allowed, let token = apnsToken, let sig = signature else { return }
        let sentPrefs = defaults.data(forKey: K.sentPrefs).flatMap { try? JSONDecoder().decode(PushPrefs.self, from: $0) }
        if defaults.string(forKey: K.registration) == sig {
            guard sentPrefs != prefs else { return }
            do {
                try await session.call("admin_push_prefs", ["device_id": deviceID, "prefs": prefs.params])
                rememberPrefs()
                return
            } catch let e as APIError where e.code == "not_registered" {
                // op de server verdwenen (overal uitloggen, token opgeruimd): opnieuw aanmelden
                defaults.removeObject(forKey: K.registration)
            } catch {
                return
            }
        }
        do {
            try await session.call("admin_push_register", [
                "device_id": deviceID, "apns_token": token, "platform": Self.platform, "sandbox": Self.sandbox,
                "app_build": Self.appBuild, "prefs": prefs.params,
            ])
            defaults.set(sig, forKey: K.registration)
            rememberPrefs()
            registered = true
            lastError = nil
        } catch let e as APIError {
            if e.code != "auth" { lastError = e.errorDescription }
        } catch {}
    }

    private func rememberPrefs() {
        if let data = try? JSONEncoder().encode(prefs) { defaults.set(data, forKey: K.sentPrefs) }
    }

    /// Schakelaar in Instellingen.
    func setPref(_ change: (inout PushPrefs) -> Void) {
        var p = prefs
        change(&p)
        guard p != prefs else { return }
        prefs = p
        if let data = try? JSONEncoder().encode(p) { defaults.set(data, forKey: K.prefs) }
        sync()
    }

    /// Afmelden bij de server (toestemming ingetrokken). Bij uitloggen gebruikt Session `unregister(token:)`.
    func unregister() async {
        guard let session, session.isSignedIn else { forget(); return }
        if (try? await session.call("admin_push_unregister", ["device_id": deviceID])) != nil { forget() }
    }

    /// Uitloggen: afmelden met het token van de sessie die net eindigt (de sessie zelf is dan al weg).
    func signOut(token: String?) {
        let id = deviceID
        let wasRegistered = registered
        forget()
        guard wasRegistered, let token else { return }
        Task.detached {
            _ = try? await AdminAPI().send("admin_push_unregister", token: token, params: ["device_id": id])
        }
    }

    /// Lokaal vergeten (bij een volgende aanmelding gaat alles opnieuw naar de server).
    func forget() {
        defaults.removeObject(forKey: K.registration)
        defaults.removeObject(forKey: K.sentPrefs)
        registered = false
        lastError = nil
        showPrompt = false
    }

    /// Testmelding naar alleen dit apparaat (rechtstreeks via APNs vanuit de functie admin).
    func sendTest() async throws {
        guard let session else { return }
        if !registered { await performSync() }
        try await session.call("admin_push_test", ["device_id": deviceID])
    }

    // MARK: tikken op een melding

    func handleTap(_ raw: String?) {
        guard let raw, let url = URL(string: raw), url.scheme?.lowercased() == "bingrbeheer" else { return }
        if let session { session.open(url) } else { pendingURL = url }
    }
}

/// Delegate van het meldingencentrum: meldingen ook tonen als de app open is, en een tik doorgeven aan PushService.
final class PushNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushNotificationDelegate()

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let raw = response.notification.request.content.userInfo["url"] as? String
        Task { @MainActor in PushService.shared.handleTap(raw) }
        completionHandler()
    }
}

/// App-delegate (UIApplicationDelegateAdaptor): delegate van het meldingencentrum vóór de eerste melding, en het APNs-token.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = PushNotificationDelegate.shared
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushService.shared.didRegister(deviceToken: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        PushService.shared.didFailToRegister()
    }
}

/// `aps-environment` uit het ingebedde provisioning-profiel (iOS: embedded.mobileprovision; Mac Catalyst:
/// Contents/embedded.provisionprofile met com.apple.developer.aps-environment). nil zonder profiel (App Store).
enum ProvisioningProfile {
    static let apsEnvironment: String? = {
        #if targetEnvironment(macCatalyst)
        let url = Bundle.main.bundleURL.appendingPathComponent("Contents/embedded.provisionprofile")
        let keys = ["com.apple.developer.aps-environment", "aps-environment"]
        #else
        let url = Bundle.main.bundleURL.appendingPathComponent("embedded.mobileprovision")
        let keys = ["aps-environment"]
        #endif
        guard let data = try? Data(contentsOf: url),
              let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex) else { return nil }
        let plist = data.subdata(in: start.lowerBound..<end.upperBound)
        guard let dict = (try? PropertyListSerialization.propertyList(from: plist, format: nil)) as? [String: Any],
              let ent = dict["Entitlements"] as? [String: Any] else { return nil }
        return keys.lazy.compactMap { ent[$0] as? String }.first
    }()
}
