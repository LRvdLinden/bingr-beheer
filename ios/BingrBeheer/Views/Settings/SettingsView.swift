import SwiftUI

/// Instellingen: vergrendelen met Face ID / Touch ID (Mac: ook wachtwoord), widgets, pushmeldingen, upgrade-link per platform (app_settings), sessie, uitloggen, Downloads (iPhone) en links.
struct SettingsView: View {
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass
    @AppStorage("lockEnabled") private var lockEnabled = false
    @AppStorage("widgetsEnabled") private var widgetsEnabled = true
    @State private var confirmLogout = false
    @State private var confirmLogoutAll = false
    @State private var loggingOutAll = false
    // upgrade-link per platform (acties app_settings_get / app_settings_set)
    @State private var links: [String: Bool]?
    @State private var linksError: String?
    @State private var linksSaving = false
    @State private var testing = false
    @Environment(\.scenePhase) private var scenePhase

    private var push: PushService { PushService.shared }

    private struct LinkPlatform: Hashable {
        let key: String
        let label: String
        let hint: String
    }

    private static let linkPlatforms: [LinkPlatform] = [
        .init(key: "apple", label: "Apple", hint: "iPhone, iPad, Apple TV en Mac"),
        .init(key: "android", label: "Android", hint: "Telefoons en tablets"),
        .init(key: "androidtv", label: "Android TV", hint: "Android TV, Google TV en Fire TV"),
        .init(key: "web", label: "Web", hint: "Webspeler en bingr.online"),
    ]

    private var version: String {
        let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let b = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        return "\(v) (build \(b))"
    }

    /// Uitleg onder Vergrendelen (Mac: Touch ID of het wachtwoord van de gebruiker, zie Session.didBecomeActive).
    private var lockFooter: String {
        let name = session.biometryName
        if Platform.isMac {
            guard session.canLock else { return "Stel eerst een wachtwoord in voor je gebruikersaccount op deze Mac." }
            let how = name == "wachtwoord" ? "het wachtwoord van je Mac-account" : name + " of het wachtwoord van je Mac-account"
            return "Bij het openen van de app, na minimaliseren of verbergen en na 5 minuten in een ander programma vraagt BingrBeheer om " + how + "."
        }
        guard session.canLock else { return "Stel eerst een toegangscode in op dit apparaat." }
        return "Bij het openen van de app (en na de achtergrond) vraagt BingrBeheer om " + name + " of je toegangscode."
    }

    var body: some View {
        Form {
            Section {
                Toggle(isOn: $lockEnabled) {
                    Label("Vergrendelen met \(session.biometryName)", systemImage: session.biometryIcon)
                }
                .disabled(!session.canLock && !lockEnabled)
            } footer: {
                Text(lockFooter)
            }

            Section {
                Toggle(isOn: $widgetsEnabled) {
                    Label("Widgets", systemImage: "square.grid.2x2")
                }
                .tint(.bingrRed)
                .onChange(of: widgetsEnabled) { _, on in
                    Task { await session.setWidgetsEnabled(on) }
                }
            } footer: {
                Text("Servicestatus en supporttickets \(Platform.isMac ? "op je bureaublad en in het berichtencentrum" : "op je beginscherm en toegangsscherm") (alleen aantallen en statusnamen). Daarvoor bewaart de app een apart widget-token (30 dagen, alleen voor de widgets) in de Keychain van dit apparaat. Uitloggen of Overal uitloggen trekt het in. Let op: widgets zijn zichtbaar zonder \(session.biometryName).")
            }

            pushSection

            Section {
                if let links {
                    ForEach(Self.linkPlatforms, id: \.key) { p in
                        Toggle(isOn: Binding(get: { links[p.key] ?? false }, set: { self.links?[p.key] = $0 })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.label)
                                Text(p.hint).font(.caption).foregroundStyle(Color.textDim)
                            }
                        }
                        .tint(.bingrRed)
                    }
                    Button {
                        Task { await saveLinks() }
                    } label: {
                        HStack {
                            if linksSaving { ProgressView() }
                            Text("Opslaan")
                        }
                    }
                    .disabled(linksSaving)
                } else if let linksError {
                    Text(linksError).foregroundStyle(Color.warn)
                } else {
                    ProgressView()
                }
            } header: {
                Text("Upgrade-link per platform")
            } footer: {
                Text("Of de apps een link, knop of QR-code naar bingr.online/upgrade/ tonen. Uit (standaard bij Apple): de apps tonen de vergelijking Gratis / Lifetime zonder link.")
            }

            Section("Sessie") {
                LabeledContent("Geldig tot", value: Fmt.dateTime(session.expiresAt))
                Button(role: .destructive) { confirmLogout = true } label: {
                    Label("Uitloggen", systemImage: "rectangle.portrait.and.arrow.right")
                }
                // build 97: alle sessies (web en app, alle apparaten) intrekken
                Button(role: .destructive) { confirmLogoutAll = true } label: {
                    HStack {
                        Label("Overal uitloggen", systemImage: "rectangle.portrait.and.arrow.right.fill")
                        if loggingOutAll { Spacer(); ProgressView() }
                    }
                }
                .disabled(loggingOutAll)
            }

            // op de iPad staat Downloads in de zijbalk; op de iPhone hier (de tabbalk heeft vijf onderdelen)
            if sizeClass != .regular {
                Section {
                    NavigationLink {
                        DownloadsView()
                    } label: {
                        Label(AppSection.downloads.title, systemImage: AppSection.downloads.icon)
                    }
                } footer: {
                    Text("Buildpakketten van Bingr en BingrBeheer (APK, Windows-installer, Xcode-projecten) van de server van beheer.bingr.online.")
                }
            }

            Section("Links") {
                Link(destination: Config.beheerSite) { Label("Beheer op het web", systemImage: "safari") }
                Link(destination: Config.supportSite) { Label("Supportsite", systemImage: "lifepreserver") }
                Link(destination: Config.statusPage) { Label("Openbare statuspagina", systemImage: "waveform.path.ecg") }
            }

            Section {
                LabeledContent("Versie", value: version)
            } footer: {
                Text("Het token staat alleen in de Keychain van dit apparaat (niet in iCloud) en is 12 uur geldig.")
            }
        }
        .scrollContentBackground(.hidden)
        .screenBackground()
        .navigationTitle("Instellingen")
        .toolbar {
            if session.section != .settings {
                ToolbarItem(placement: .confirmationAction) { Button("Klaar") { dismiss() } }
            }
        }
        .task { if links == nil { await loadLinks() } }
        .confirmationDialog("Uitloggen?", isPresented: $confirmLogout, titleVisibility: .visible) {
            Button("Uitloggen", role: .destructive) {
                dismiss()
                session.logout()
            }
        }
        .confirmationDialog("Overal uitloggen?", isPresented: $confirmLogoutAll, titleVisibility: .visible) {
            Button("Overal uitloggen", role: .destructive) {
                Task { await logoutAll() }
            }
        } message: {
            Text("Alle sessies van het beheer (deze app, andere apparaten en het web-dashboard) vervallen meteen.")
        }
    }

    // MARK: pushmeldingen

    private var permissionText: (String, Color) {
        switch push.permission {
        case .allowed: return ("Toegestaan", .ok)
        case .denied: return ("Geweigerd", .warn)
        case .notDetermined: return ("Nog niet gevraagd", .textSecondary)
        case .unknown: return ("Onbekend", .textSecondary)
        }
    }

    private func prefToggle(_ title: String, _ icon: String, _ key: WritableKeyPath<PushPrefs, Bool>) -> some View {
        Toggle(isOn: Binding(get: { push.prefs[keyPath: key] }, set: { v in push.setPref { $0[keyPath: key] = v } })) {
            Label(title, systemImage: icon)
        }
        .tint(.bingrRed)
    }

    @ViewBuilder private var pushSection: some View {
        Section {
            LabeledContent("Systeemtoestemming") {
                Text(permissionText.0).foregroundStyle(permissionText.1)
            }
            switch push.permission {
            case .notDetermined, .unknown:
                Button { Task { await push.requestPermission() } } label: {
                    Label("Meldingen toestaan", systemImage: "bell.badge")
                }
            case .denied:
                Button { push.openSystemSettings() } label: {
                    Label("Open systeeminstellingen", systemImage: "gear")
                }
            case .allowed:
                LabeledContent("Aangemeld bij de server") {
                    Text(push.registered ? "Ja" : "Nog niet").foregroundStyle(push.registered ? Color.ok : Color.textSecondary)
                }
            }
            if let e = push.lastError {
                Text(e).font(.caption).foregroundStyle(Color.warn)
            }
            prefToggle("Nieuwe tickets", "lifepreserver", \.tickets)
            prefToggle("Nieuwe antwoorden", "bubble.left.and.bubble.right", \.replies)
            prefToggle("Nieuwe builds", "arrow.down.circle", \.builds)
            prefToggle("Statuswijzigingen", "waveform.path.ecg", \.status)
            Button {
                Task { await sendTest() }
            } label: {
                HStack {
                    Label("Testmelding sturen", systemImage: "paperplane")
                    if testing { Spacer(); ProgressView() }
                }
            }
            .disabled(testing || push.permission != .allowed)
        } header: {
            Text("Pushmeldingen")
        } footer: {
            Text("Meldingen van BingrBeheer op dit apparaat: nieuwe supporttickets, antwoorden van klanten, nieuwe builds in Downloads en wijzigingen van de servicestatus. Tik op een melding om het ticket, Downloads of Status te openen. Uitloggen meldt dit apparaat af; Overal uitloggen meldt alle apparaten af.")
        }
        .onChange(of: scenePhase) { _, p in if p == .active { Task { await push.refresh() } } }
        .task { await push.refresh() }
    }

    private func sendTest() async {
        testing = true
        defer { testing = false }
        do {
            try await push.sendTest()
            session.show("Testmelding verstuurd. Hij komt binnen een paar seconden binnen.")
        } catch {
            session.report(error)
        }
    }

    private func loadLinks() async {
        do {
            let r = try await session.call("app_settings_get")
            var out: [String: Bool] = [:]
            for p in Self.linkPlatforms { out[p.key] = r["upgrade_link"][p.key].bool ?? (p.key != "apple") }
            links = out
            linksError = nil
        } catch {
            if error is CancellationError { return }
            linksError = (error as? APIError)?.errorDescription ?? APIError.text("server_error")
        }
    }

    private func logoutAll() async {
        loggingOutAll = true
        defer { loggingOutAll = false }
        do {
            try await session.logoutAll()
            dismiss()
        } catch {
            session.report(error)
        }
    }

    private func saveLinks() async {
        guard let links else { return }
        linksSaving = true
        defer { linksSaving = false }
        do {
            try await session.call("app_settings_set", ["upgrade_link": links])
            session.show("Upgrade-link opgeslagen. De apps nemen het binnen een paar minuten over.")
        } catch {
            session.report(error)
        }
    }
}
