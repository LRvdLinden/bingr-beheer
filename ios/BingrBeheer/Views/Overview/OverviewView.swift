import SwiftUI

/// Tab Overzicht: instelbaar dashboard met widgets (kengetallen, grafieken per dag, platforms, versies, abonnementen,
/// support, servicestatus, berichten). Grootte, volgorde, zichtbaarheid en getoonde gegevens zijn in te stellen;
/// de indeling staat als JSON in UserDefaults (zelfde model als het web-dashboard, zie Models/Dashboard.swift).
struct OverviewView: View {
    @Environment(Session.self) private var session
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var layout = DashStore.load()
    @State private var data = DashData()
    @State private var editing = false
    @State private var settingsFor: DashWidget?
    @State private var showManage = false
    @State private var confirmReset = false
    @State private var loading = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let error = data.statsError, data.stats == nil {
                    NoticeBanner(text: error)
                }
                if editing { editPanel }
                let visible = layout.visible
                if visible.isEmpty {
                    emptyPanel
                } else {
                    DashGridLayout(columns: sizeClass == .regular ? 4 : 2) {
                        ForEach(Array(visible.enumerated()), id: \.element.id) { index, w in
                            widgetView(w, index: index, count: visible.count)
                                .layoutValue(key: DashSpanKey.self, value: w.size)
                        }
                    }
                }
            }
            .padding(16)
        }
        .screenBackground()
        .navigationTitle("Overzicht")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if editing {
                    Button("Klaar") { withAnimation { editing = false } }.bold()
                } else {
                    Button("Wijzig") { withAnimation { editing = true } }
                        .accessibilityHint("Widgets verplaatsen, vergroten, instellen of verbergen")
                }
            }
        }
        .refreshable { await load() }
        .task { if data.stats == nil { await load() } }
        .onChange(of: session.usersRevision) { Task { await load() } }
        .onChange(of: layout) { DashStore.save(layout) }
        .sheet(item: $settingsFor) { w in
            DashWidgetSettingsView(widget: w, title: title(w), knownPlatforms: data.knownPlatforms) { updated in
                if let i = layout.widgets.firstIndex(where: { $0.id == updated.id }) { layout.widgets[i] = updated }
                ensureData()
            }
        }
        .sheet(isPresented: $showManage) {
            DashManageView(layout: $layout, titleFor: title) { ensureData() }
        }
        .confirmationDialog("Standaardindeling herstellen?", isPresented: $confirmReset, titleVisibility: .visible) {
            Button("Standaard herstellen", role: .destructive) {
                withAnimation { layout = .standard }
                ensureData()
                session.show("Standaardindeling hersteld.")
            }
        } message: {
            Text("Je eigen indeling en de instellingen van de widgets gaan verloren.")
        }
    }

    private func title(_ w: DashWidget) -> String { DashText.title(w, stats: data.stats) }

    // MARK: widgets

    @ViewBuilder private func widgetView(_ w: DashWidget, index: Int, count: Int) -> some View {
        let card = DashWidgetCard(widget: w, data: data, support: session.supportCounts, editing: editing, open: open)
        if editing {
            card
                .opacity(0.85)
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
                .overlay(alignment: .top) {
                    DashEditBar(widget: w, title: title(w), isFirst: index == 0, isLast: index == count - 1,
                                setSize: { z in update(w.id) { $0.size = z } },
                                move: { move(w.id, by: $0) },
                                settings: { settingsFor = w },
                                hide: {
                                    update(w.id) { $0.hidden = true }
                                    session.show("\(title(w)) verborgen. Terugzetten kan via Widgets.")
                                })
                    .padding(6)
                }
                // slepen: lang drukken en op een andere widget loslaten
                .draggable(w.id) {
                    Text(title(w)).font(.headline).padding(12)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Color.surface3))
                }
                .dropDestination(for: String.self) { ids, _ in
                    guard let id = ids.first else { return false }
                    return place(id, onto: w.id)
                }
                .accessibilityElement(children: .contain)
                .accessibilityActions {
                    if index > 0 { Button("Naar voren") { move(w.id, by: -1) } }
                    if index < count - 1 { Button("Naar achteren") { move(w.id, by: 1) } }
                    Button("Instellen") { settingsFor = w }
                    Button("Verbergen") { update(w.id) { $0.hidden = true } }
                }
        } else {
            card
        }
    }

    private var editPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Houd een widget vast en sleep hem naar een andere plek, of gebruik de pijlen. Kies S, M of L voor de grootte en de schuifjes voor de getoonde gegevens.")
                .font(.subheadline)
                .foregroundStyle(Color.textSecondary)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { editButtons }
                VStack(alignment: .leading, spacing: 8) { editButtons }
            }
        }
        .card(padding: 14, highlight: .bingrRed)
    }

    @ViewBuilder private var editButtons: some View {
        Button { showManage = true } label: { Label("Widgets", systemImage: "square.grid.2x2") }
            .buttonStyle(.bingr)
        Button { confirmReset = true } label: { Label("Standaard herstellen", systemImage: "arrow.counterclockwise") }
            .buttonStyle(.bingrGhost)
        Button { withAnimation { editing = false } } label: { Text("Klaar") }
            .buttonStyle(.bingrGhost)
    }

    private var emptyPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "Geen widgets op het overzicht", subtitle: "Voeg widgets toe uit de galerij of herstel de standaardindeling.")
            HStack(spacing: 8) {
                Button("Widgets") { showManage = true }.buttonStyle(.bingr)
                Button("Standaard herstellen") { confirmReset = true }.buttonStyle(.bingrGhost)
            }
        }
        .card()
    }

    // MARK: indeling wijzigen

    private func update(_ id: String, _ change: (inout DashWidget) -> Void) {
        guard let i = layout.widgets.firstIndex(where: { $0.id == id }) else { return }
        withAnimation(.snappy) { change(&layout.widgets[i]) }
    }

    /// Eén plek naar voren (-1) of naar achteren (+1) tussen de zichtbare widgets.
    private func move(_ id: String, by delta: Int) {
        let visible = layout.visible
        guard let i = visible.firstIndex(where: { $0.id == id }), visible.indices.contains(i + delta),
              let from = layout.widgets.firstIndex(where: { $0.id == id }),
              let to = layout.widgets.firstIndex(where: { $0.id == visible[i + delta].id }) else { return }
        withAnimation(.snappy) {
            let w = layout.widgets.remove(at: from)
            layout.widgets.insert(w, at: to)
        }
    }

    /// Slepen en loslaten: de gesleepte widget komt op de plek van het doel.
    private func place(_ id: String, onto target: String) -> Bool {
        guard id != target, let from = layout.widgets.firstIndex(where: { $0.id == id }),
              let to = layout.widgets.firstIndex(where: { $0.id == target }) else { return false }
        withAnimation(.snappy) {
            let w = layout.widgets.remove(at: from)
            layout.widgets.insert(w, at: to)
        }
        return true
    }

    private func open(_ target: DashTarget) {
        switch target {
        case .users(let filter):
            session.usersFilter = filter
            session.section = .users
        case .support(let filter):
            UserDefaults.standard.set(filter, forKey: "supportFilter")
            session.section = .support
        case .status:
            session.section = .status
        case .messages:
            session.section = .messages
        }
    }

    // MARK: laden

    private var needsStatus: Bool {
        layout.visible.contains { $0.type == .status || ($0.type == .platforms && $0.options.source == "live") }
    }

    private var needsAnnouncements: Bool { layout.visible.contains { $0.type == .announcements } }

    /// Na toevoegen of instellen: ontbrekende gegevens (status, berichten) alsnog ophalen.
    private func ensureData() {
        let missing = (needsStatus && data.status == nil && data.statusError == nil)
            || (needsAnnouncements && data.announcements == nil && data.announcementsError == nil)
        if missing { Task { await load() } }
    }

    private func fetch(_ action: String, _ params: [String: Any?] = [:], when needed: Bool = true) async -> Result<JSON, Error>? {
        guard needed else { return nil }
        do { return .success(try await session.call(action, params)) } catch { return .failure(error) }
    }

    private static func message(_ error: Error) -> String {
        (error as? APIError)?.errorDescription ?? APIError.text("server_error")
    }

    private static func isAuth(_ r: Result<JSON, Error>?) -> Bool {
        if case .failure(let e) = r { return (e as? APIError)?.code == "auth" || e is CancellationError }
        return false
    }

    private func load() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        async let statsResult = fetch("stats")
        async let statusResult = fetch("status", ["op": "overview"], when: needsStatus)
        async let annResult = fetch("announcements_list", when: needsAnnouncements)
        let (rs, rst, ra) = await (statsResult, statusResult, annResult)
        if Self.isAuth(rs) || Self.isAuth(rst) || Self.isAuth(ra) { return }

        var d = data
        switch rs {
        case .success(let j)?:
            d.stats = Stats(j)
            d.statsError = nil
        case .failure(let e)?:
            d.statsError = Self.message(e)
            session.report(e)
        case nil:
            break
        }
        switch rst {
        case .success(let j)?:
            let ov = StatusOverview(j)
            let state = j["overall"]["state"].text ?? "up"
            let level = j["overall"]["level"].text ?? (["down": "major", "degraded": "degraded"][state] ?? "operational")
            let ids = j["overall"][level].strings.isEmpty ? j["overall"][state].strings : j["overall"][level].strings
            d.status = ov
            d.statusLevel = level
            d.statusAffected = ids.map { ov.monitorName($0) }
            d.statusError = nil
        case .failure(let e)?:
            d.statusError = Self.message(e)
        case nil:
            break
        }
        switch ra {
        case .success(let j)?:
            d.announcements = j["items"].array.map(Announcement.init)
            d.announcementsError = nil
        case .failure(let e)?:
            d.announcementsError = Self.message(e)
        case nil:
            break
        }
        data = d
        await session.refreshSupportCounts()
    }
}
