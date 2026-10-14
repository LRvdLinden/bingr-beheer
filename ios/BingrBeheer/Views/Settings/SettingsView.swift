import SwiftUI

/// Instellingen: vergrendelen met Face ID, sessie, uitloggen en links.
struct SettingsView: View {
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @AppStorage("lockEnabled") private var lockEnabled = false
    @State private var confirmLogout = false

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
        .confirmationDialog("Uitloggen?", isPresented: $confirmLogout, titleVisibility: .visible) {
            Button("Uitloggen", role: .destructive) {
                dismiss()
                session.logout()
            }
        }
    }
}
