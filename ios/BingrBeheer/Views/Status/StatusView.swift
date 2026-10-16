import SwiftUI

/// Tab Status: totaalstatus, planning en alerts, meldingen (storingen en gepland onderhoud), actieve apparaten, storingen
/// en alle monitors (via `status`).
struct StatusView: View {
    @Environment(Session.self) private var session
    @State private var data: StatusOverview?
    @State private var error: String?
    @State private var running = false
    @State private var editing: MonitorEditTarget?
    @State private var noticeEditing: NoticeEditTarget?

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: 12)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let error, data == nil {
                    NoticeBanner(text: error)
                }
                if let d = data {
                    banner(d)
                    LazyVGrid(columns: columns, spacing: 12) { infoTiles(d) }
                    noticesCard(d)
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 12) { devicesCard(d); incidentsCard(d) }.frame(minWidth: 720)
                        VStack(spacing: 12) { devicesCard(d); incidentsCard(d) }
                    }
                    ForEach(d.groups) { g in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(g.name).font(.headline).padding(.bottom, 6)
                            ForEach(g.monitors) { m in
                                NavigationLink(value: m) {
                                    MonitorRowView(monitor: m, activeDevices: d.devices.reduce(0) { $0 + $1.devices })
                                }
                                .buttonStyle(.plain)
                                if m.id != g.monitors.last?.id { Divider().overlay(Color.line) }
                            }
                        }
                        .card()
                    }
                } else if error == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
            .padding(16)
        }
        .screenBackground()
        .navigationTitle("Status")
        .navigationDestination(for: Monitor.self) { m in
            MonitorDetailView(monitorID: m.id, initial: m, overview: $data, reload: { await load() })
        }
        .navigationDestination(for: StatusNotice.self) { n in
            NoticeDetailView(noticeID: n.id, initial: n, overview: $data, reload: { await load() })
        }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Menu {
                    Button { noticeEditing = NoticeEditTarget(kind: "incident", notice: nil) } label: {
                        Label("Storing melden", systemImage: "exclamationmark.triangle")
                    }
                    Button { noticeEditing = NoticeEditTarget(kind: "maintenance", notice: nil) } label: {
                        Label("Onderhoud plannen", systemImage: "wrench.and.screwdriver")
                    }
                    Button { editing = MonitorEditTarget(monitor: nil) } label: { Label("Monitor toevoegen", systemImage: "plus") }
                    Link(destination: Config.statusPage) { Label("Openbare pagina", systemImage: "safari") }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                Button {
                    Task { await runAll() }
                } label: {
                    if running { ProgressView() } else { Text("Nu controleren") }
                }
                .disabled(running)
            }
        }
        .sheet(item: $editing) { t in
            NavigationStack {
                MonitorEditView(monitor: t.monitor, intervals: data?.intervals ?? [5, 10, 15, 30, 60, 360, 720, 1440]) {
                    await load()
                }
            }
        }
        .sheet(item: $noticeEditing) { t in
            NavigationStack {
                NoticeEditView(kind: t.kind, notice: t.notice, overview: data) {
                    await load()
                }
            }
        }
        .refreshableCommand { await load() }
        .task { if data == nil { await load() } }
    }

    // MARK: onderdelen

    private func banner(_ d: StatusOverview) -> some View {
        let title: String
        switch d.overallState {
        case "down": title = "Storing bij \(d.down.map(d.monitorName).joined(separator: ", "))"
        case "degraded": title = "Verminderd: \(d.degraded.map(d.monitorName).joined(separator: ", "))"
        default: title = "Alle systemen werken"
        }
        return HStack(spacing: 14) {
            StateDot(state: d.overallState, size: 16)
                .background(Circle().fill(Color.monitorState(d.overallState).opacity(0.2)).frame(width: 28, height: 28))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text("Bijgewerkt \(Fmt.dateTime(d.generatedAt))").font(.caption).foregroundStyle(Color.textDim)
            }
        }
        .card(highlight: d.overallState == "up" ? nil : Color.monitorState(d.overallState))
    }

    @ViewBuilder private func infoTiles(_ d: StatusOverview) -> some View {
        let sourceName = ["cron": "planning", "admin": "beheer", "deploy": "deploy"]
        let lastRecent = d.lastRunAt.map { Date().timeIntervalSince($0) < 12 * 60 } ?? false
        KPITile(label: "Planning", value: d.cronExists ? (d.cronActive ? "Actief" : "Uit") : "Geen",
                hint: d.cronExists
                    ? "pg_cron \(d.cronSchedule ?? "")" + (d.cronLastStatus.map { " · \($0) \(Fmt.ago(d.cronLastStart))" } ?? "")
                    : "pg_cron niet gevonden",
                valueColor: d.cronActive ? .stateUp : .stateDown, small: true)
        KPITile(label: "Laatste controle", value: d.lastRunAt.map { Fmt.ago($0) } ?? "nooit",
                hint: d.lastSource.map { "door \(sourceName[$0] ?? $0)" } ?? "",
                valueColor: lastRecent ? .stateUp : .stateDown, small: true)
        KPITile(label: "Alert-e-mail", value: d.alertEmail != nil ? "Aan" : "Uit",
                hint: d.alertEmail.map { $0 + (d.alertSMTP ? "" : " · SMTP ontbreekt") } ?? "BINGR_ALERT_EMAIL niet ingesteld",
                valueColor: d.alertEmail != nil && d.alertSMTP ? .stateUp : .stateDegraded, small: true)
        KPITile(label: "Open storingen", value: "\(d.openIncidents)", hint: d.openIncidents > 0 ? "zie hieronder" : "geen",
                valueColor: d.openIncidents > 0 ? .stateDown : .stateUp, small: true)
    }

    /// Meldingen op bingr.online/status: lopend, gepland en afgelopen (zoals renderNotices in web/admin.js).
    private func noticesCard(_ d: StatusOverview) -> some View {
        let open = d.notices.filter(\.isOpen)
        let planned = d.notices.filter { $0.isPlanned && !$0.isOpen }
            .sorted { ($0.windowStart ?? .distantFuture) < ($1.windowStart ?? .distantFuture) }
        let past = Array(d.notices.filter { !$0.isOpen && !$0.isPlanned }.prefix(10))
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                CardHeader(title: "Meldingen", subtitle: "Storingen en gepland onderhoud op bingr.online/status")
                Spacer()
                Menu {
                    Button { noticeEditing = NoticeEditTarget(kind: "incident", notice: nil) } label: {
                        Label("Storing melden", systemImage: "exclamationmark.triangle")
                    }
                    Button { noticeEditing = NoticeEditTarget(kind: "maintenance", notice: nil) } label: {
                        Label("Onderhoud plannen", systemImage: "wrench.and.screwdriver")
                    }
                } label: {
                    Image(systemName: "plus.circle").font(.title3)
                }
                .accessibilityLabel("Melding toevoegen")
            }
            if open.isEmpty && planned.isEmpty && past.isEmpty {
                EmptyText(text: "Nog geen meldingen. Storingen die de monitoring vindt, verschijnen hier vanzelf.")
            }
            noticeSection("Lopend", open, d)
            noticeSection("Gepland", planned, d)
            noticeSection("Afgelopen", past, d)
        }
        .card()
    }

    @ViewBuilder private func noticeSection(_ title: String, _ items: [StatusNotice], _ d: StatusOverview) -> some View {
        if !items.isEmpty {
            Text(title.uppercased(with: Fmt.nl)).font(.caption.weight(.bold)).foregroundStyle(Color.textDim).padding(.top, 6)
            ForEach(items) { n in
                NavigationLink(value: n) {
                    NoticeRowView(notice: n, monitorName: d.monitorName)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func devicesCard(_ d: StatusOverview) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "Actieve apparaten", subtitle: "Per platform, gezien in de laatste 15 minuten (alleen hier, niet openbaar)")
            HBarList(rows: d.devices.map { .init(label: Labels.platform($0.platform), icon: Labels.platformIcon($0.platform), value: $0.devices) })
        }
        .card()
    }

    private func incidentsCard(_ d: StatusOverview) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "Storingen", subtitle: "Laatste 90 dagen, met oorzaak")
            if d.incidents.isEmpty {
                EmptyText(text: "Geen storingen in de laatste 90 dagen.")
            }
            ForEach(d.incidents.prefix(12)) { i in
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(i.name).font(.subheadline.weight(.bold))
                            if i.endedAt == nil { Chip(text: "loopt nog", tone: .bad) }
                        }
                        Text(i.cause ?? "onbekende oorzaak").font(.caption).foregroundStyle(Color.textDim)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(Fmt.dateTime(i.startedAt)).font(.caption)
                        Text(Fmt.duration(seconds: i.durationS)).font(.caption).foregroundStyle(Color.textDim)
                    }
                }
            }
        }
        .card()
    }

    // MARK: acties

    private func load() async {
        do {
            data = StatusOverview(try await session.call("status", ["op": "overview"]))
            error = nil
            // widgets met de servicestatus meteen bijwerken
            session.reloadWidgets(WidgetShared.statusKind)
        } catch {
            if error is CancellationError { return }
            self.error = (error as? APIError)?.errorDescription ?? APIError.text("server_error")
            session.report(error)
        }
    }

    private func runAll() async {
        running = true
        defer { running = false }
        do {
            let r = try await session.call("status", ["op": "run"])
            if r["busy"].bool == true {
                session.show("Er loopt al een controle; probeer het over een minuut opnieuw.", bad: true)
            } else {
                let down = r["down"].int ?? 0
                session.show("\(r["checked"].int ?? 0) gecontroleerd: \(r["up"].int ?? 0) werkt, \(r["degraded"].int ?? 0) verminderd, \(down) storing.",
                             bad: down > 0)
            }
            await load()
        } catch {
            session.report(error)
        }
    }
}

struct MonitorEditTarget: Identifiable {
    let id = UUID()
    let monitor: Monitor?
}

/// Rij van een monitor: stip, naam, soort, laatste 60 dagen en uptime.
struct MonitorRowView: View {
    let monitor: Monitor
    let activeDevices: Int
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        let m = monitor
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                StateDot(state: m.dotState).padding(.top, 5)
                VStack(alignment: .leading, spacing: 2) {
                    Text(m.nameNl).font(.subheadline.weight(.bold))
                    HStack(spacing: 4) {
                        Text("\(Labels.monitorKind(m.kind)) · \(Fmt.interval(m.intervalMin))")
                        if !m.isPublic { Chip(text: "niet openbaar") }
                        if !m.enabled { Chip(text: "uit", tone: .warn) }
                    }
                    .font(.caption).foregroundStyle(Color.textDim)
                    if let e = m.lastError {
                        Text(e).font(.caption).foregroundStyle(Color.warn).lineLimit(2)
                    }
                }
                Spacer(minLength: 8)
                if !m.isInfo {
                    HStack(spacing: 12) {
                        uptime(m.uptime1, "24 u")
                        uptime(m.uptime7, "7 d")
                        if sizeClass == .regular {
                            uptime(m.uptime30, "30 d")
                            uptime(m.uptime90, "90 d")
                        }
                        VStack(alignment: .trailing, spacing: 0) {
                            Text(m.ms24.map { Fmt.num(Int($0.rounded())) } ?? "—").font(.caption.weight(.bold)).monospacedDigit()
                            Text("ms").font(.caption2).foregroundStyle(Color.textDim)
                        }
                    }
                }
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(Color.textDim).padding(.top, 4)
            }
            if m.isInfo {
                Text("\(Fmt.num(activeDevices)) apparaten actief (laatste 15 min)").font(.caption).foregroundStyle(Color.textDim)
                    .padding(.leading, 20)
            } else {
                DayBars(days: Array(m.days.suffix(sizeClass == .regular ? 60 : 40)))
                    .padding(.leading, 20)
            }
        }
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }

    private func uptime(_ v: Double?, _ label: String) -> some View {
        VStack(alignment: .trailing, spacing: 0) {
            Text(Fmt.pct(v)).font(.caption.weight(.bold)).monospacedDigit()
            Text(label).font(.caption2).foregroundStyle(Color.textDim)
        }
    }
}

/// Staafjes per dag (groen/oranje/rood/grijs).
struct DayBars: View {
    let days: [Monitor.DayBar]

    var body: some View {
        HStack(spacing: 2) {
            ForEach(Array(days.enumerated()), id: \.offset) { _, d in
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(Color.monitorState(d.state == "none" ? nil : d.state))
                    .frame(maxWidth: .infinity)
                    .frame(height: 18)
                    .accessibilityLabel("\(d.day): \(d.uptime.map { Fmt.pct($0) } ?? "geen gegevens")")
            }
        }
    }
}
