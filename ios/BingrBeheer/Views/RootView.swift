import SwiftUI

/// Inloggen, of het beheer (tabbalk op iPhone, zijbalk op iPad en Mac); met vergrendelscherm en meldingen eroverheen.
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
            // vergrendeld, of afgeschermd in de app-wisselaar (iOS)
            if shielded {
                LockView(showButton: showUnlockButton)
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
            #if targetEnvironment(macCatalyst)
            if phase == .inactive { session.didResignActive() }
            if phase == .active { session.didBecomeActive() }
            #endif
            if phase == .active {
                Task { await session.refreshSupportCounts() }
                // pushmeldingen: toestemming kan in de systeeminstellingen veranderd zijn; token opnieuw ophalen
                Task { await PushService.shared.refresh() }
            }
        }
        // pushmeldingen: eenmalig na het inloggen, op een rustig moment (PushService.didSignIn)
        .alert("Pushmeldingen aanzetten?", isPresented: Binding(
            get: { PushService.shared.showPrompt && session.isSignedIn && !shielded },
            set: { if !$0 && PushService.shared.showPrompt { PushService.shared.answerPrompt(false) } }
        )) {
            Button("Niet nu", role: .cancel) { PushService.shared.answerPrompt(false) }
            Button("Aanzetten") { PushService.shared.answerPrompt(true) }
        } message: {
            Text("BingrBeheer kan een melding sturen bij nieuwe supporttickets, antwoorden van klanten, nieuwe builds en statuswijzigingen. Per soort aan of uit te zetten in Instellingen.")
        }
    }

    /// iOS: ook afschermen zolang de app niet actief is (app-wisselaar). Mac: alleen als hij echt vergrendeld is; een
    /// venster dat niet voorop staat blijft gewoon zichtbaar.
    private var shielded: Bool {
        guard session.isSignedIn && session.lockEnabled else { return false }
        #if targetEnvironment(macCatalyst)
        return session.isLocked
        #else
        return session.isLocked || scenePhase != .active
        #endif
    }

    private var showUnlockButton: Bool {
        #if targetEnvironment(macCatalyst)
        return session.isLocked
        #else
        return session.isLocked && scenePhase == .active
        #endif
    }
}

/// iPhone: tabbalk met de vijf onderdelen; Nieuwsbrief, Downloads en Instellingen via het menu rechtsboven. Vraagt iets anders om
/// Downloads of Instellingen (deeplink bingrbeheer://downloads uit een pushmelding), dan opent dat als blad.
struct TabLayout: View {
    @Environment(Session.self) private var session
    @State private var sheet: AppSection?

    private static let tabs: [AppSection] = [.overview, .users, .support, .messages, .status]

    var body: some View {
        @Bindable var session = session
        TabView(selection: $session.section) {
            ForEach(Self.tabs) { s in
                SectionScreen(section: s)
                    .tabItem { Label(s.title, systemImage: s.icon) }
                    .tag(s)
                    .badge(s == .support ? (session.supportCounts?.unread ?? 0) : 0)
            }
        }
        .onChange(of: session.section, initial: true) { old, new in
            guard !Self.tabs.contains(new) else { return }
            sheet = new
            session.section = Self.tabs.contains(old) ? old : .overview
        }
        .sheet(item: $sheet) { s in
            NavigationStack {
                if s == .downloads || s == .newsletter || s == .insights {
                    Group {
                        if s == .downloads { DownloadsView() } else if s == .insights { InsightsView() } else { NewsletterView() }
                    }
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) { Button("Klaar") { sheet = nil } }
                    }
                } else {
                    SettingsView()
                }
            }
        }
    }
}

/// iPad en Mac: zijbalk met de onderdelen, rechts het gekozen onderdeel.
struct SplitLayout: View {
    @Environment(Session.self) private var session
    @State private var visibility: NavigationSplitViewVisibility = .all

    var body: some View {
        NavigationSplitView(columnVisibility: $visibility) {
            List(selection: Binding<AppSection?>(get: { session.section }, set: { if let s = $0 { session.section = s } })) {
                Section {
                    ForEach([AppSection.overview, .insights, .users, .support, .messages, .newsletter, .status]) { s in
                        Label(s.title, systemImage: s.icon)
                            .badge(s == .support ? (session.supportCounts?.unread ?? 0) : 0)
                            .tag(s)
                    }
                }
                Section {
                    // Downloads: op de iPhone via Instellingen (de tabbalk heeft vijf onderdelen)
                    Label(AppSection.downloads.title, systemImage: AppSection.downloads.icon).tag(AppSection.downloads)
                    Label(AppSection.settings.title, systemImage: AppSection.settings.icon).tag(AppSection.settings)
                }
            }
            .navigationTitle("")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { BingrLogo(size: 20) }
            }
            .navigationSplitViewColumnWidth(min: 220, ideal: 250)
        } detail: {
            SectionScreen(section: session.section, compact: false)
                .id(session.section)
        }
        .navigationSplitViewStyle(.balanced)
    }
}

/// Eén onderdeel met een eigen navigatiestapel, met rechtsboven het menu (app-icoon met pijltje, zoals het profielmenu van
/// de webspeler en het menu van het web-dashboard).
struct SectionScreen: View {
    let section: AppSection
    /// iPhone (tabbalk): Downloads en Instellingen openen als blad; iPad (zijbalk): als onderdeel
    var compact = true
    @Environment(Session.self) private var session
    @State private var showSettings = false
    @State private var showDownloads = false
    @State private var showNewsletter = false
    @State private var showInsights = false
    @State private var confirmLogout = false
    @State private var confirmLogoutAll = false

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
        .sheet(isPresented: $showDownloads) {
            NavigationStack {
                DownloadsView()
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) { Button("Klaar") { showDownloads = false } }
                    }
            }
        }
        .sheet(isPresented: $showNewsletter) {
            NavigationStack {
                NewsletterView()
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) { Button("Klaar") { showNewsletter = false } }
                    }
            }
        }
        .sheet(isPresented: $showInsights) {
            NavigationStack {
                InsightsView()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) { Button("Klaar") { showInsights = false } }
                    }
            }
        }
        .confirmationDialog("Uitloggen?", isPresented: $confirmLogout, titleVisibility: .visible) {
            Button("Uitloggen", role: .destructive) { session.logout() }
        }
        .confirmationDialog("Overal uitloggen?", isPresented: $confirmLogoutAll, titleVisibility: .visible) {
            Button("Overal uitloggen", role: .destructive) {
                Task {
                    do { try await session.logoutAll() } catch { session.report(error) }
                }
            }
        } message: {
            Text("Alle sessies van het beheer (deze app, andere apparaten en het web-dashboard) vervallen meteen.")
        }
    }

    @ViewBuilder private var content: some View {
        Group {
            switch section {
            case .overview: OverviewView()
            case .insights: InsightsView()
            case .users: UsersView()
            case .support: SupportView()
            case .messages: MessagesView()
            case .newsletter: NewsletterView()
            case .status: StatusView()
            case .downloads: DownloadsView()
            case .settings: SettingsView()
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                AppMenuButton(
                    compact: compact,
                    select: { s in
                        if compact && s == .settings { showSettings = true }
                        else if compact && s == .downloads { showDownloads = true }
                        else if compact && s == .newsletter { showNewsletter = true }
                        else if compact && s == .insights { showInsights = true }
                        else { session.section = s }
                    },
                    logout: { confirmLogout = true },
                    logoutAll: { confirmLogoutAll = true }
                )
            }
        }
        .toolbarBackground(Color.black, for: .navigationBar)
    }
}

/// Menu rechtsboven: het app-icoon van BingrBeheer met een pijltje; items: de onderdelen, Overal uitloggen en Uitloggen
/// (zoals het menu van het web-dashboard). Een rode stip op het icoon bij ongelezen supporttickets.
struct AppMenuButton: View {
    var compact: Bool
    var select: (AppSection) -> Void
    var logout: () -> Void
    var logoutAll: () -> Void
    @Environment(Session.self) private var session

    private var unread: Int { session.supportCounts?.unread ?? 0 }

    private func title(_ s: AppSection) -> String {
        s == .support && unread > 0 ? "\(s.title) (\(unread))" : s.title
    }

    var body: some View {
        Menu {
            Section {
                ForEach([AppSection.overview, .insights, .users, .support, .messages, .newsletter, .status]) { s in
                    Button { select(s) } label: {
                        Label(title(s), systemImage: !compact && s == session.section ? "checkmark" : s.icon)
                    }
                }
            }
            Section {
                ForEach([AppSection.downloads, .settings]) { s in
                    Button { select(s) } label: {
                        Label(s.title, systemImage: !compact && s == session.section ? "checkmark" : s.icon)
                    }
                }
            }
            Section {
                Button(role: .destructive, action: logoutAll) {
                    Label("Overal uitloggen", systemImage: "rectangle.portrait.and.arrow.right.fill")
                }
                Button(action: logout) {
                    Label("Uitloggen", systemImage: "rectangle.portrait.and.arrow.right")
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image("MenuIcon")
                    .renderingMode(.original)
                    .resizable()
                    .interpolation(.high)
                    .frame(width: 30, height: 30)
                    .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(Color.white.opacity(0.25), lineWidth: 1))
                    .overlay(alignment: .topTrailing) {
                        if unread > 0 {
                            Circle().fill(Color.bingrRed)
                                .frame(width: 10, height: 10)
                                .overlay(Circle().stroke(Color.black, lineWidth: 2))
                                .offset(x: 3, y: -3)
                        }
                    }
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color.textSecondary)
            }
            .contentShape(Rectangle())
        }
        .accessibilityLabel(unread > 0 ? "Menu, \(unread) ongelezen in Support" : "Menu")
    }
}
