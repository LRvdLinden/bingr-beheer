import SwiftUI

/// Details van een monitor: toestand, uptime, reactietijd (24 uur) en de laatste controles; bewerken en nu controleren.
struct MonitorDetailView: View {
    let monitorID: String
    let initial: Monitor
    @Binding var overview: StatusOverview?
    let reload: () async -> Void

    @Environment(Session.self) private var session
    @State private var checks: [MonitorCheck] = []
    @State private var checksLoaded = false
    @State private var checksError: String?
    @State private var running = false
    @State private var editing = false

    private var monitor: Monitor {
        overview?.allMonitors.first { $0.id == monitorID } ?? initial
    }

    var body: some View {
        let m = monitor
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        StateDot(state: m.dotState, size: 12)
                        Text(m.stateText.capitalized(with: Fmt.nl)).font(.headline)
                    }
                    Text("\(m.nameEn) · \(Labels.monitorKind(m.kind))").font(.caption).foregroundStyle(Color.textDim)
                    if let t = m.target {
                        InfoRow(label: "Doel") {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(t).textSelection(.enabled)
                                if let k = m.keyword { Text("trefwoord “\(k)”").font(.caption).foregroundStyle(Color.textDim) }
                            }
                        }
                    }
                    InfoRow("Laatst gecontroleerd", m.checkedAt.map { Fmt.dateTime($0) } ?? "nooit")
                    if let e = m.lastError { InfoRow("Laatste fout", e) }
                    InfoRow("Uptime", "\(Fmt.pct(m.uptime1)) (24 u) · \(Fmt.pct(m.uptime7)) (7 d) · \(Fmt.pct(m.uptime30)) (30 d) · \(Fmt.pct(m.uptime90)) (90 d)")
                    InfoRow("Interval", Fmt.interval(m.intervalMin))
                    InfoRow("Openbaar", m.isPublic ? "Ja" : "Nee")
                }
                .card()

                if !m.isInfo {
                    VStack(alignment: .leading, spacing: 12) {
                        CardHeader(title: "Reactietijd", subtitle: "Laatste 24 uur, ms")
                        if checksLoaded { ResponseTimeChart(checks: checks) } else { ProgressView() }
                    }
                    .card()

                    VStack(alignment: .leading, spacing: 10) {
                        CardHeader(title: "Laatste controles")
                        if let checksError { Text(checksError).font(.subheadline).foregroundStyle(Color.warn) }
                        if checksLoaded && checks.isEmpty { EmptyText(text: "Geen controles in de laatste 24 uur.") }
                        ForEach(checks.prefix(60)) { c in
                            HStack(alignment: .top, spacing: 10) {
                                Text(Fmt.time(c.at)).font(.caption.monospacedDigit()).frame(width: 44, alignment: .leading)
                                HStack(spacing: 4) {
                                    StateDot(state: c.state, size: 8)
                                    Text(Labels.monitorState(c.state)).font(.caption)
                                }
                                .frame(width: 92, alignment: .leading)
                                Text(c.statusCode.map { String($0) } ?? "").font(.caption.monospacedDigit()).frame(width: 34, alignment: .leading)
                                Text(c.ms.map { "\(Int($0.rounded())) ms" } ?? "").font(.caption.monospacedDigit()).frame(width: 60, alignment: .leading)
                                Text(c.error ?? c.detail ?? "").font(.caption).foregroundStyle(Color.textDim).lineLimit(3)
                            }
                        }
                    }
                    .card()
                }
            }
            .padding(16)
            .frame(maxWidth: 860, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .screenBackground()
        .navigationTitle(m.nameNl)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button("Bewerken") { editing = true }
                if !m.isInfo {
                    Button {
                        Task { await runOne() }
                    } label: {
                        if running { ProgressView() } else { Text("Controleren") }
                    }
                    .disabled(running)
                }
            }
        }
        .sheet(isPresented: $editing) {
            NavigationStack {
                MonitorEditView(monitor: m, intervals: overview?.intervals ?? [5, 10, 15, 30, 60, 360, 720, 1440]) {
                    await reload()
                    await loadChecks()
                }
            }
        }
        .refreshable {
            await reload()
            await loadChecks()
        }
        .task { if !checksLoaded { await loadChecks() } }
    }

    private func loadChecks() async {
        guard !monitor.isInfo else { return }
        do {
            let r = try await session.call("status", ["op": "checks", "monitor_id": monitorID, "limit": 300])
            checks = r["items"].array.map(MonitorCheck.init)
            checksError = nil
        } catch {
            if error is CancellationError { return }
            checksError = (error as? APIError)?.errorDescription
        }
        checksLoaded = true
    }

    private func runOne() async {
        running = true
        defer { running = false }
        do {
            let r = try await session.call("status", ["op": "run", "monitor_id": monitorID])
            if r["busy"].bool == true {
                session.show("Er loopt al een controle.", bad: true)
            } else if let x = r["results"].array.first {
                var t = Labels.monitorState(x["state"].text)
                if let ms = x["ms"].int { t += ", \(ms) ms" }
                if let e = x["error"].text { t += ": \(e)" }
                session.show(t, bad: x["ok"].bool == false)
            } else {
                session.show("Gecontroleerd.")
            }
            await reload()
            await loadChecks()
        } catch {
            session.report(error)
        }
    }
}
