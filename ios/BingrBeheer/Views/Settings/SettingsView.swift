import SwiftUI

/// Instellingen: vergrendelen met Face ID, upgrade-link per platform (app_settings), sessie, uitloggen en links.
struct SettingsView: View {
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @AppStorage("lockEnabled") private var lockEnabled = false
    @State private var confirmLogout = false
    // upgrade-link per platform (acties app_settings_get / app_settings_set)
    @State private var links: [String: Bool]?
    @State private var linksError: String?
    @State private var linksSaving = false

    private struct LinkPlatform: Hashable {
        let key: String
        let label: String
        let hint: String
    }

    private static let linkPlatforms: [LinkPlatform] = [
        .init(key: "apple", label: "Apple", hint: "iPhone, iPad, Apple TV en Mac"),
        .init(key: "android", label: "Android", hint: "Telefoons en tablets"),
        .init(key: "androidtv", label: "Android TV", hint: "Android TV, Google TV en Fire TV"),
        .init(key: "tizen", label: "Samsung TV", hint: "Tizen"),
        .init(key: "web", label: "Web", hint: "Webspeler en bingr.online"),
    ]

    private var version: String {
        let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let b = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        return "\(v) (build \(b))"
    }

    var body: some View {
        Form {
            Section {
                Toggle(isOn: $lockEnabled) {
                    Label("Vergrendelen met \(session.biometryName)", systemImage: session.biometryName == "Face ID" ? "faceid" : "lock")
                }
                .disabled(!session.canLock && !lockEnabled)
            } footer: {
                Text(session.canLock
                     ? "Bij het openen van de app (en na de achtergrond) vraagt Bingr Beheer om \(session.biometryName) of je toegangscode."
                     : "Stel eerst een toegangscode in op dit apparaat.")
            }

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
