#if targetEnvironment(macCatalyst)
import SwiftUI
import UIKit

// Alleen de Mac-app (Mac Catalyst): venstergrootte en menubalk. Op iPhone/iPad wordt dit bestand niet gecompileerd.

/// Venstergrootte op de Mac: standaard (eerste keer; daarna onthoudt macOS de grootte) en minimaal.
enum MacWindow {
    static let defaultSize = CGSize(width: 1280, height: 820)
    static let minimumSize = CGSize(width: 900, height: 620)
}

/// Zet de minimale venstergrootte en verbergt de venstertitel (de navigatiebalk toont de titel al). Als achtergrond
/// achter RootView: zodra het view in een venster hangt, is de UIWindowScene bekend.
struct MacWindowConfigurator: UIViewRepresentable {
    func makeUIView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.isUserInteractionEnabled = false
        return view
    }
    func updateUIView(_ uiView: ProbeView, context: Context) {}

    final class ProbeView: UIView {
        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard let scene = window?.windowScene else { return }
            scene.sizeRestrictions?.minimumSize = MacWindow.minimumSize
            if let titlebar = scene.titlebar {
                titlebar.titleVisibility = .hidden
                titlebar.toolbar = nil
            }
        }
    }
}

/// Menubalk: menu Beheer met Vernieuwen (⌘R) en de onderdelen (⌘1 … ⌘7), Instellingen (⌘,) in het app-menu,
/// geen Nieuw venster (één venster), en in Help de links naar het web.
struct BeheerCommands: Commands {
    let session: Session

    private static let sections: [AppSection] = [.overview, .users, .support, .messages, .newsletter, .status, .downloads]

    var body: some Commands {
        CommandGroup(replacing: .newItem) {}

        CommandGroup(replacing: .appSettings) {
            Button("Instellingen…") { onMain { $0.section = .settings } }
                .keyboardShortcut(",", modifiers: .command)
        }

        CommandMenu("Beheer") {
            Button("Vernieuwen") { onMain { $0.requestRefresh() } }
                .keyboardShortcut("r", modifiers: .command)
            Divider()
            ForEach(Array(Self.sections.enumerated()), id: \.element) { index, section in
                Button(section.title) { onMain { $0.section = section } }
                    .keyboardShortcut(KeyEquivalent(Character(String(index + 1))), modifiers: .command)
            }
        }

        CommandGroup(replacing: .help) {
            Button("Beheer op het web") { openLink(Config.beheerSite) }
            Button("Supportsite") { openLink(Config.supportSite) }
            Button("Openbare statuspagina") { openLink(Config.statusPage) }
        }
    }

    /// Menuacties op de main actor (Session en UIApplication zijn @MainActor).
    private func onMain(_ action: @escaping @MainActor (Session) -> Void) {
        let session = session
        Task { @MainActor in action(session) }
    }

    private func openLink(_ url: URL) {
        Task { @MainActor in _ = await UIApplication.shared.open(url) }
    }
}
#endif
