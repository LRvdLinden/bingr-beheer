import Charts
import SwiftUI

/// Tab Server: Supabase- en servergegevens (actie server). Zelfde bediening als Insights: reeksen kiezen, één periode
/// (7, 30 of 90 dagen of 1 jaar) en terugbladeren; één meetpunt per dag (UTC). Bovenaan de actuele stand, onderaan
/// tabellen, apparaten per platform, cron-jobs, opslag, wachtrijen en de piek per uur van vandaag.
struct ServerView: View {
    @Environment(Session.self) private var session
    @Environment(\.horizontalSizeClass) private var sizeClass
    @AppStorage("serverSources") private var sourcesText = "database,accounts,streams,devices"
    @AppStorage("serverPeriod") private var periodRaw = ServerPeriod.d30.rawValue
    @State private var offset = 0
    @State private var data: ServerData?
    @State private var now: ServerNow?
    @State private var error: String?
    @State private var showSources = false

    private static let palette: [Color] = [Color(hex: 0x3987E5), Color(hex: 0xD95926), Color(hex: 0x199E70), Color(hex: 0x9B6BDF),
                                           Color(hex: 0xD6A525), Color(hex: 0xD9468C), Color(hex: 0x2BB3C0), Color(hex: 0x8A94A6), Color(hex: 0x7FB83A)]

    private var period: ServerPeriod { ServerPeriod(rawValue: periodRaw) ?? .d30 }
    private var sources: [ServerSource] {
        let keys = sourcesText.split(separator: ",").map(String.init)
        return ServerSource.allCases.filter { keys.contains($0.rawValue) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let error { NoticeBanner(text: error) }
                if let n = now { tiles(n) }
                periodBar
                ForEach(sources) { s in chartCard(s) }
                if let n = now { details(n) }
                Text("Alles komt uit de database zelf (alleen aantallen en groottes); elk uur schrijft pg_cron de stand van de dag weg, elke 5 minuten de piek van gelijktijdige streams. Aanroepen, fouten en duur per Edge Function vult de workflow Serverstatistieken in iptv-ios-appletv met het token dat al als GitHub-secret bestaat.")
                    .font(.caption).foregroundStyle(Color.textDim)
            }
            .padding(16)
        }
        .screenBackground()
        .navigationTitle("Server")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { showSources = true } label: { Label("Reeksen", systemImage: "slider.horizontal.3") }
            }
        }
        .sheet(isPresented: $showSources) { sourcesSheet }
        .refreshableCommand { now = nil; await load() }
        .task(id: "\(periodRaw)|\(offset)") { await load() }
    }

    // MARK: actuele stand

    private func tiles(_ n: ServerNow) -> some View {
        let c = n.counts, t = n.today
        let cols = [GridItem(.adaptive(minimum: sizeClass == .regular ? 200 : 150), spacing: 12)]
        return LazyVGrid(columns: cols, spacing: 12) {
            tile("Database", Fmt.bytes(n.dbBytes), "\(Fmt.num(n.connections)) verbindingen")
            tile("Accounts", Fmt.num(c["accounts"].int), "\(Fmt.num(c["active_30d"].int)) actief (30 d) · +\(Fmt.num(t["new_users"].int)) vandaag")
            tile("Kijkt nu", Fmt.num(c["streams_now"].int), "piek vandaag \(Fmt.num(t["streams_peak"].int))", color: .ok)
            tile("Apparaten", Fmt.num(c["devices"].int), "\(Fmt.num(c["push_devices"].int)) met push")
            tile("Opslag", Fmt.bytes(t["storage_bytes"].double), Fmt.plural(t["storage_objects"].int ?? 0, "bestand", "bestanden"))
            tile("Webproxy (30 d)", Fmt.bytes(n.proxy30d["bytes"].double), "\(Fmt.num(n.proxy30d["requests"].int)) verzoeken")
            tile("Inloggen vandaag", Fmt.num(t["signins"].int), "\(Fmt.num(t["login_failures"].int)) fout · \(Fmt.num(c["locked_now"].int)) nu dicht")
            tile("Push en mail vandaag", Fmt.num((t["push_sent"].int ?? 0) + (t["mail_sent"].int ?? 0)),
                 "\(Fmt.num(t["push_failed"].int)) push en \(Fmt.num(t["mail_failed"].int)) mail mislukt")
        }
    }

    private func tile(_ label: String, _ value: String, _ hint: String, color: Color = .white) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.subheadline.weight(.semibold)).foregroundStyle(Color.textSecondary).lineLimit(1)
            Text(value).font(.system(size: 26, weight: .black)).monospacedDigit().foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.6)
            Text(hint).font(.caption).foregroundStyle(Color.textDim).lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
    }

    // MARK: periode

    private var periodBar: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(rangeText).font(.title3.weight(.bold)).lineLimit(2)
                Spacer()
                Button { offset -= 1 } label: { Image(systemName: "chevron.left") }
                    .disabled(!(data?.hasPrev ?? false)).accessibilityLabel("Vorige periode")
                Button("Nu") { offset = 0 }.disabled(offset == 0)
                Button { offset = min(0, offset + 1) } label: { Image(systemName: "chevron.right") }
                    .disabled(offset == 0).accessibilityLabel("Volgende periode")
            }
            Picker("Periode", selection: Binding(get: { periodRaw }, set: { periodRaw = $0; offset = 0 })) {
                ForEach(ServerPeriod.allCases) { p in Text(p.tab).tag(p.rawValue) }
            }
            .pickerStyle(.segmented)
        }
        .card(padding: 14)
    }

    private var rangeText: String {
        guard let d = data, let a = d.edges.first, let b = d.edges.last else { return period.tab }
        let f = DateFormatter()
        f.locale = Locale(identifier: "nl_NL")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "d MMM yyyy"
        return "\(f.string(from: a)) – \(f.string(from: b.addingTimeInterval(-1)))"
    }

    // MARK: grafieken

    private struct Point: Identifiable {
        let id = UUID()
        let date: Date
        let key: String
        let value: Double
    }

    @ViewBuilder private func chartCard(_ s: ServerSource) -> some View {
        let src = data?.sources[s.rawValue]
        let series = (src?.series ?? []).filter(\.available)
        VStack(alignment: .leading, spacing: 10) {
            CardHeader(title: s.name, subtitle: src?.desc)
            if data == nil {
                RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.05)).frame(height: 180).accessibilityLabel("Laden")
            } else if series.isEmpty {
                EmptyText(text: s.rawValue.hasPrefix("fn_") ? "Nog geen gegevens van de Edge Functions (workflow Serverstatistieken)." : "Geen gegevens in deze periode.")
            } else if let d = data {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(series.enumerated()), id: \.element.id) { i, x in summaryChip(x, color: Self.palette[i % Self.palette.count]) }
                    }
                }
                chart(d, series: series, bars: s.bars && d.step == "day")
                    .frame(height: 190)
            }
        }
        .card()
    }

    private func summaryChip(_ x: ServerSeries, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 12, height: 4)
                Text(x.label).font(.caption).foregroundStyle(Color.textSecondary).lineLimit(1)
            }
            Text(x.format(x.total)).font(.headline).monospacedDigit()
            if let c = x.changePct {
                let good = c == 0 ? nil : (c > 0) != x.down
                Text("\(c > 0 ? "▲ +" : c < 0 ? "▼ " : "→ ")\(String(format: "%.1f", c).replacingOccurrences(of: ".", with: ","))%")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(good == nil ? Color.textDim : good! ? Color.ok : Color.bad)
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.04)))
    }

    private func chart(_ d: ServerData, series: [ServerSeries], bars: Bool) -> some View {
        let points: [Point] = series.flatMap { s in
            s.values.enumerated().compactMap { i, v in v.map { Point(date: d.edges[i], key: s.label, value: $0) } }
        }
        let colors = series.enumerated().map { Self.palette[$0.offset % Self.palette.count] }
        let bytes = series.allSatisfy(\.bytes)
        return Chart(points) { p in
            if bars {
                BarMark(x: .value("Dag", p.date, unit: .day), y: .value("Waarde", p.value))
                    .foregroundStyle(by: .value("Reeks", p.key))
                    .position(by: .value("Reeks", p.key))
                    .cornerRadius(3)
            } else {
                LineMark(x: .value("Dag", p.date), y: .value("Waarde", p.value), series: .value("Reeks", p.key))
                    .foregroundStyle(by: .value("Reeks", p.key))
                    .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                    .interpolationMethod(.monotone)
            }
        }
        .chartForegroundStyleScale(domain: series.map(\.label), range: colors)
        .chartLegend(.hidden)
        .chartYAxis {
            AxisMarks { v in
                AxisGridLine().foregroundStyle(Color.white.opacity(0.08))
                AxisValueLabel {
                    if let n = v.as(Double.self) { Text(bytes ? Fmt.bytes(n) : n >= 10_000 ? "\(Int(n / 1000))K" : Fmt.num(Int(n))).font(.caption2) }
                }
            }
        }
    }

    // MARK: details

    @ViewBuilder private func details(_ n: ServerNow) -> some View {
        let cols = [GridItem(.adaptive(minimum: sizeClass == .regular ? 320 : 280), spacing: 12, alignment: .top)]
        LazyVGrid(columns: cols, alignment: .leading, spacing: 12) {
            panel("Tabellen", "Grootste tabellen met indexen; rijen geschat") {
                ForEach(n.tables.prefix(12)) { x in
                    line(x.name, Fmt.bytes(x.bytes), x.rows.map { "≈ \(Fmt.num($0))" }, mono: true)
                }
            }
            panel("Apparaten per platform", "Totaal · actief in 30 dagen · nu") {
                ForEach(n.devices) { x in
                    line(Labels.platform(x.platform), Fmt.num(x.devices), "\(Fmt.num(x.active30d)) · \(Fmt.num(x.live))", icon: Labels.platformIcon(x.platform))
                }
            }
            panel("Cron-jobs", "pg_cron: laatste uitvoering en fouten in 24 uur") {
                if n.cron.isEmpty { EmptyText(text: "Geen cron-jobs gevonden.") }
                ForEach(n.cron) { j in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(j.name).font(.caption.monospaced()).lineLimit(1)
                            if !j.active { Chip(text: "uit") }
                            Spacer()
                            Chip(text: ["succeeded": "geslaagd", "failed": "mislukt", "running": "bezig"][j.lastStatus ?? ""] ?? (j.lastStatus ?? "nog niet"),
                                 tone: j.lastStatus == "failed" ? .bad : j.lastStatus == "succeeded" ? .good : .neutral)
                        }
                        Text("\(j.schedule) · \(Fmt.ago(j.lastStart)) · fouten \(Fmt.num(j.failed24h)) / \(Fmt.num(j.runs24h))")
                            .font(.caption2).foregroundStyle(j.failed24h > 0 ? Color.bad : Color.textDim)
                    }
                }
            }
            panel("Opslag", "Storage-buckets") {
                ForEach(n.storage) { b in line(b.bucket, Fmt.bytes(b.bytes), Fmt.plural(b.objects, "bestand", "bestanden"), mono: true) }
            }
            panel("Wachtrijen en webproxy", "Nu in de wachtrij · webproxy 30 dagen") {
                line("Push-afleveringen", Fmt.num(n.queues["push"].int), nil)
                line("Nieuwsbrief", Fmt.num(n.queues["newsletter"].int), nil)
                line("Eigen mailing", Fmt.num(n.queues["mailing"].int), nil)
                line("Statusmails", Fmt.num(n.queues["status_mail"].int), nil)
                line("Webproxy: verzoeken", Fmt.num(n.proxy30d["requests"].int), nil)
                line("Webproxy: verkeer", Fmt.bytes(n.proxy30d["bytes"].double), nil)
            }
            panel("Piek per uur", "Gelijktijdige streams vandaag (UTC)") {
                let hours = n.peakHours.filter { $0.value > 0 }
                HBarList(rows: hours.map { HBarList.Row(label: String(format: "%02d:00", $0.hour), value: $0.value) }, limit: 24)
            }
        }
    }

    private func panel<C: View>(_ title: String, _ sub: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            CardHeader(title: title, subtitle: sub)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func line(_ label: String, _ value: String, _ extra: String?, icon: String? = nil, mono: Bool = false) -> some View {
        HStack(spacing: 8) {
            if let icon { Image(systemName: icon).font(.caption).foregroundStyle(Color.textSecondary).frame(width: 18) }
            Text(label).font(mono ? .caption.monospaced() : .subheadline).lineLimit(1)
            Spacer(minLength: 8)
            if let extra { Text(extra).font(.caption).foregroundStyle(Color.textDim).monospacedDigit() }
            Text(value).font(.subheadline.weight(.semibold)).monospacedDigit()
        }
    }

    // MARK: reeksen kiezen

    private var sourcesSheet: some View {
        NavigationStack {
            List {
                ForEach(ServerSource.allCases) { s in
                    Toggle(s.name, isOn: Binding(
                        get: { sources.contains(s) },
                        set: { on in
                            var cur = Set(sources.map(\.rawValue))
                            if on { cur.insert(s.rawValue) } else { cur.remove(s.rawValue) }
                            sourcesText = ServerSource.allCases.map(\.rawValue).filter { cur.contains($0) }.joined(separator: ",")
                        }))
                    .listRowBackground(Color.surface1)
                }
            }
            .scrollContentBackground(.hidden)
            .screenBackground()
            .navigationTitle("Reeksen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Klaar") { showSources = false } } }
        }
    }

    // MARK: laden

    private func load() async {
        do {
            let j = try await session.call("server", ["period": period.rawValue, "offset": offset, "now": now == nil])
            guard let d = ServerData(j, period: period) else { error = APIError.text("server_error"); return }
            data = d
            if let n = d.now { now = n }
            error = nil
        } catch {
            if error is CancellationError || (error as? APIError)?.code == "auth" { return }
            self.error = (error as? APIError)?.errorDescription ?? APIError.text("server_error")
        }
    }
}
