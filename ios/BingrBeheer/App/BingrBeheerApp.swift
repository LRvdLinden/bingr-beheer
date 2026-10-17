import SwiftUI

@main
struct BingrBeheerApp: App {
    /// Pushmeldingen: delegate van het meldingencentrum en het APNs-token (App/PushService.swift)
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var session = Session()

    var body: some Scene {
        #if targetEnvironment(macCatalyst)
        // Mac: standaardgrootte van het venster (daarna onthoudt macOS de grootte) en de menubalk (BeheerCommands)
        mainWindow
            .defaultSize(width: MacWindow.defaultSize.width, height: MacWindow.defaultSize.height)
            .commands { BeheerCommands(session: session) }
        #else
        mainWindow
        #endif
    }

    private var mainWindow: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .preferredColorScheme(.dark)
                .tint(.bingrRed)
                .onOpenURL { session.open($0) }
                .task { PushService.shared.attach(session) }
                #if targetEnvironment(macCatalyst)
                .background { MacWindowConfigurator() }
                #endif
        }
    }
}
