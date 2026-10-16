import SwiftUI

@main
struct BingrBeheerApp: App {
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
                #if targetEnvironment(macCatalyst)
                .background { MacWindowConfigurator() }
                #endif
        }
    }
}
