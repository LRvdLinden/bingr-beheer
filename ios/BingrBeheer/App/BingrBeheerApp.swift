import SwiftUI

@main
struct BingrBeheerApp: App {
    @State private var session = Session()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .preferredColorScheme(.dark)
                .tint(.bingrRed)
                .onOpenURL { session.open($0) }
        }
    }
}
