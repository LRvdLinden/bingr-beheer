import SwiftUI

/// Vergrendelscherm (Face ID / Touch ID / toegangscode). Zonder knop: alleen afschermen in de app-wisselaar.
struct LockView: View {
    let showButton: Bool
    @Environment(Session.self) private var session

    var body: some View {
        ZStack {
            CoverWall().ignoresSafeArea()
            VStack(spacing: 28) {
                BingrLogo(size: 34)
                if showButton {
                    Button {
                        Task { await session.unlock() }
                    } label: {
                        Label("Ontgrendelen", systemImage: session.biometryName == "Face ID" ? "faceid" : "lock.open")
                    }
                    .buttonStyle(.bingr)
                }
            }
        }
        .task(id: showButton) {
            if showButton && !session.autoUnlockTried {
                session.autoUnlockTried = true
                await session.unlock()
            }
        }
    }
}
