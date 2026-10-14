import SwiftUI

/// Tab Overzicht: kengetallen, nieuwe gebruikers en inlogs per dag, apparaten per platform en app-versies.
struct OverviewView: View {
    @Environment(Session.self) private var session
    @State private var stats: Stats?
    @State private var error: String?

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 12)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let error, stats == nil {
                    NoticeBanner(text: error)
                }
                LazyVGrid(columns: columns, spacing: 12) {
                    KPITile(label: "Gebruikers", value: value(stats?.totalUsers), hint: "\(Fmt.num(stats?.confirmedUsers)) bevestigd")
                    KPITile(label: "Nieuw (7 dagen)", value: value(stats?.newUsers7d))
                    KPITile(label: "Actief vandaag", value: value(stats?.activeToday), hint: "accounts")
                    KPITile(label: "Actief (30 dagen)", value: value(stats?.active30d), hint: "accounts")
                    KPITile(label: "Apparaten", value: value(stats?.devicesTotal), hint: "gekoppeld")
                    KPITile(label: "Kijkt nu", value: value(stats?.watchingNow), hint: "streams",
                            valueColor: .ok, highlight: (stats?.watchingNow ?? 0) > 0 ? .ok : nil)
                    Button {
                        session.section = .support
                    } label: {
                        let c = session.supportCounts
                        KPITile(label: "Open tickets", value: c.map { Fmt.num($0.active) } ?? "—", hint: c?.hint ?? "support",
                                hintColor: (c?.unread ?? 0) > 0 ? Color(hex: 0xFF8A8F) : .textDim,
                                highlight: (c?.unread ?? 0) > 0 ? .bingrRed : nil)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Naar Support")
                }

                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 12) { chartCards }
                        .frame(minWidth: 720)
                    VStack(spacing: 12) { chartCards }
                }

                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 12) { barCards }
                        .frame(minWidth: 720)
                    VStack(spacing: 12) { barCards }
                }
            }
            .padding(16)
        }
        .screenBackground()
        .navigationTitle("Overzicht")
        .refreshable { await load() }
        .task { if stats == nil { await load() } }
    }

    private func value(_ n: Int?) -> String {
        n.map { Fmt.num($0) } ?? "—"
    }

    @ViewBuilder private var chartCards: some View {
        let days = stats?.days ?? []
        let audit = stats?.signinsFromAudit ?? true
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "Nieuwe gebruikers per dag", subtitle: "Laatste 30 dagen")
            DailyBarChart(points: days.map { .init(day: $0.day, value: $0.newUsers) }, unit: "nieuwe gebruikers")
        }
        .card()
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: audit ? "Inloggen per dag" : "Actieve accounts per dag",
                       subtitle: audit ? "Laatste 30 dagen, uit het inloglogboek"
                                       : "Laatste 30 dagen, accounts met app-activiteit (inloglogboek leeg)")
            DailyBarChart(points: days.map { .init(day: $0.day, value: $0.signins) }, unit: audit ? "inlogs" : "actieve accounts")
        }
        .card()
    }

    @ViewBuilder private var barCards: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "Actieve apparaten per platform", subtitle: "Gezien in de laatste 30 dagen")
            HBarList(rows: (stats?.platforms ?? []).map {
                .init(label: Labels.platform($0.platform), icon: Labels.platformIcon($0.platform), value: $0.devices)
            })
        }
        .card()
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "App-versies in gebruik", subtitle: "Per platform, laatste 30 dagen")
            HBarList(rows: (stats?.versions ?? []).map {
                .init(label: $0.version == "?" ? "onbekend" : ($0.version ?? "onbekend"), detail: Labels.platform($0.platform),
                      value: $0.devices)
            })
        }
        .card()
    }

    private func load() async {
        do {
            let r = try await session.call("stats")
            stats = Stats(r)
            error = nil
        } catch {
            if error is CancellationError { return }
            self.error = (error as? APIError)?.errorDescription ?? APIError.text("server_error")
            session.report(error)
        }
        await session.refreshSupportCounts()
    }
}
