import SwiftUI

/// Inloggen, of het beheer (tabbalk op iPhone, zijbalk op iPad); met vergrendelscherm en meldingen eroverheen.
struct RootView: View {
    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if session.isSignedIn {
                if sizeClass == .regular {
                    SplitLayout()
                } else {
                    TabLayout()
                }
            } else {
                LoginView()
            }
            // vergrendeld, of afgeschermd in de app-wisselaar
            if session.isSignedIn && session.lockEnabled && (session.isLocked || scenePhase != .active) {
                LockView(showButton: session.isLocked && scenePhase == .active)
                    .transition(.opacity)
            }
        }
        .overlay(alignment: .bottom) {
            if let t = session.toast {
                ToastView(toast: t)
                    .padding(.bottom, 70)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .onTapGesture { session.toast = nil }
                    .task(id: t.id) {
                        try? await Task.sleep(for: .seconds(3.5))
                        if session.toast?.id == t.id { withAnimation { session.toast = nil } }
                    }
            }
        }
        .animation(.easeOut(duration: 0.2), value: session.toast)
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { session.didEnterBackground() }
            if phase == .active { Task { await session.refreshSupportCounts() } }
        }
    }
}

/// iPhone: tabbalk met de vijf onderdelen; Instellingen via het tandwiel.
struct TabLayout: View {
    @Environment(Session.self) private var session

    var body: some View {
        @Bindable var session = session
        TabView(selection: $session.section) {
            ForEach([AppSection.overview, .users, .support, .messages, .status]) { s in
                SectionScreen(section: s)
                    .tabItem { Label(s.title, systemImage: s.icon) }
                    .tag(s)
                    .badge(s == .support ? (session.supportCounts?.unread ?? 0) : 0)
            }
        }
    }
}

/// iPad: zijbalk met de onderdelen, rechts het gekozen onderdeel.
struct SplitLayout: View {
    @Environment(Session.self) private var session
    @State private var visibility: NavigationSplitViewVisibility = .all

    var body: some View {
        NavigationSplitView(columnVisibility: $visibility) {
            List(selection: Binding<AppSection?>(get: { session.section }, set: { if let s = $0 { session.section = s } })) {
                Section {
                    ForEach([AppSection.overview, .users, .support, .messages, .status]) { s in
                        Label(s.title, systemImage: s.icon)
                            .badge(s == .support ? (session.supportCounts?.unread ?? 0) : 0)
                            .tag(s)
                    }
                }
                Section {
                    Label(AppSection.settings.title, systemImage: AppSection.settings.icon).tag(AppSection.settings)
                }
            }
            .navigationTitle("")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { BingrLogo(size: 20) }
            }
            .navigationSplitViewColumnWidth(min: 220, ideal: 250)
        } detail: {
            SectionScreen(section: session.section, showsSettingsButton: false)
                .id(session.section)
        }
        .navigationSplitViewStyle(.balanced)
    }
}

/// Eén onderdeel met een eigen navigatiestapel.
struct SectionScreen: View {
    let section: AppSection
    var showsSettingsButton = true
    @Environment(Session.self) private var session
    @State private var showSettings = false

    var body: some View {
        @Bindable var session = session
        Group {
            if section == .support {
                NavigationStack(path: $session.supportPath) {
                    content
                }
            } else {
                NavigationStack { content }
            }
        }
        .sheet(isPresented: $showSettings) {
            NavigationStack { SettingsView() }
        }
    }

    @ViewBuilder private var content: some View {
        Group {
            switch section {
            case .overview: OverviewView()
            case .users: UsersView()
            case .support: SupportView()
            case .messages: MessagesView()
            case .status: StatusView()
            case .settings: SettingsView()
            }
        }
        .toolbar {
            if showsSettingsButton && section != .settings {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("Instellingen")
                }
            }
        }
        .toolbarBackground(Color.black, for: .navigationBar)
    }
}
