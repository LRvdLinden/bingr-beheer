import Charts
import SwiftUI

// Grafieken zoals Homey Insights (zelfde gedrag als fillInsights / insChart in web/admin.js): vloeiende lijn met kleurverloop
// of staven, periodekiezer met bladeren, crosshair met waarden (chartXSelection), series aan/uit via de samenvatting
// (= legenda), storingen en onderhoud als banden op de tijdas.

// MARK: grafiek

struct InsightsChart: View {
    let data: InsightsData
    let shown: [InsSeries]
    let bars: Bool
    /// Gedeelde selectie (tab Insights: één crosshair over alle grafieken).
    @Binding var selection: Date?
    var height: CGFloat = 200

    private struct Pt: Identifiable {
        let id: String
        let key: String
        let label: String
        let date: Date
        let value: Double
    }

    private var points: [Pt] {
        shown.flatMap { s in
            s.values.indices.compactMap { i -> Pt? in
                guard let v = s.values[i] else { return nil }
                return Pt(id: "\(s.key)-\(i)", key: s.key, label: s.label, date: data.mid(i), value: v)
            }
        }
    }

    private var top: Double {
        let m = max(1, shown.flatMap { $0.values.compactMap { $0 } }.max() ?? 1)
        let raw = m / 4, p = pow(10, floor(log10(raw)))
        let step = [1.0, 2, 5, 10].map { $0 * p }.first { $0 >= raw } ?? 10 * p
        return ceil(m / max(1, step)) * max(1, step)
    }

    private var selectedIndex: Int? { selection.flatMap { data.index(of: $0) } }

    private var barUnit: Calendar.Component {
        switch data.step {
        case "5min": return .minute
        case "hour": return .hour
        case "week": return .weekOfYear
        default: return .day
        }
    }

    /// As-labels: hoogstens ~6, op logische plekken (hele uren, middernacht, dagen, begin van de maand).
    private var ticks: [Date] {
        let n = data.count, cal = InsFmt.calendar
        var idx: [Int]
        switch data.step {
        case "hour" where n > 48:
            idx = (0..<n).filter { cal.component(.hour, from: data.start($0)) == 0 }
        case "hour":
            let k = [1, 2, 3, 4, 6, 12].first { (n + $0 - 1) / $0 <= 6 } ?? 12
            idx = (0..<n).filter { cal.component(.hour, from: data.start($0)) % k == 0 }
        case "week":
            idx = (0..<n).filter { $0 == 0 || cal.component(.month, from: data.start($0)) != cal.component(.month, from: data.start($0 - 1)) }
            idx = idx.enumerated().filter { $0.offset % 2 == 0 }.map(\.element)
        case "day" where n > 7:
            let k = [2, 5, 7, 10].first { (n + $0 - 1) / $0 <= 6 } ?? 10
            idx = (0..<n).filter { ($0 - (n - 1) % k) % k == 0 && $0 >= (n - 1) % k }
        default:
            let k = max(1, (n + 5) / 6)
            idx = (0..<n).filter { $0 % k == 0 }
        }
        let atStart = data.step == "week" || (data.step == "hour" && n > 48)
        return idx.map { atStart ? data.start($0) : data.mid($0) }
    }

    var body: some View {
        if shown.isEmpty || data.isEmpty(shown: shown) {
            VStack(spacing: 6) {
                Image(systemName: "chart.line.flattrend.xyaxis").font(.title2).foregroundStyle(Color.textDim)
                Text("Geen gegevens in deze periode").font(.subheadline.weight(.semibold)).foregroundStyle(Color.textSecondary)
                if data.hasPrev { Text("Blader met ‹ naar een eerdere periode.").font(.caption).foregroundStyle(Color.textDim) }
            }
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.white.opacity(0.12), style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
        } else {
            chart
        }
    }

    private var chart: some View {
        Chart {
            ForEach(data.events) { e in
                RectangleMark(xStart: .value("Van", max(e.from, data.from)), xEnd: .value("Tot", min(e.to ?? Date(), data.to)))
                    .foregroundStyle((e.isMaintenance ? InsColor.maintenance : InsColor.incident).opacity(0.16))
            }
            if bars {
                ForEach(points) { p in
                    BarMark(x: .value("Tijd", p.date, unit: barUnit), y: .value("Aantal", p.value))
                        .position(by: .value("Serie", p.key))
                        .foregroundStyle(InsColor.color(data.metric, p.key))
                        .cornerRadius(3)
                        .opacity(selectedIndex == nil || data.index(of: p.date) == selectedIndex ? 1 : 0.35)
                }
            } else {
                ForEach(points) { p in
                    AreaMark(x: .value("Tijd", p.date), y: .value("Aantal", p.value), series: .value("Serie", p.key), stacking: .unstacked)
                        .foregroundStyle(LinearGradient(colors: [InsColor.color(data.metric, p.key).opacity(0.26), InsColor.color(data.metric, p.key).opacity(0)],
                                                        startPoint: .top, endPoint: .bottom))
                        .interpolationMethod(.monotone)
                }
                ForEach(points) { p in
                    LineMark(x: .value("Tijd", p.date), y: .value("Aantal", p.value), series: .value("Serie", p.key))
                        .foregroundStyle(InsColor.color(data.metric, p.key))
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                        .interpolationMethod(.monotone)
                }
            }
            if let i = selectedIndex {
                RuleMark(x: .value("Tijd", data.mid(i)))
                    .foregroundStyle(Color.white.opacity(0.6))
                    .lineStyle(StrokeStyle(lineWidth: 1))
                    .annotation(position: .top, spacing: 0, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        tooltip(i)
                    }
                if !bars {
                    ForEach(shown) { s in
                        if let v = s.values[i] {
                            PointMark(x: .value("Tijd", data.mid(i)), y: .value("Aantal", v))
                                .foregroundStyle(Color.surface1).symbolSize(120)
                            PointMark(x: .value("Tijd", data.mid(i)), y: .value("Aantal", v))
                                .foregroundStyle(InsColor.color(data.metric, s.key)).symbolSize(50)
                        }
                    }
                }
            }
        }
        .chartXSelection(value: $selection)
        .chartXScale(domain: data.from...data.to)
        .chartYScale(domain: 0...top)
        .chartLegend(.hidden)
        .chartXAxis {
            AxisMarks(values: ticks) { value in
                AxisTick().foregroundStyle(Color.clear)
                AxisValueLabel {
                    if let d = value.as(Date.self) { Text(InsFmt.axis(data, d)) }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
                AxisGridLine().foregroundStyle(Color.white.opacity(0.07))
                AxisValueLabel {
                    if let v = value.as(Double.self) { Text(InsFmt.compact(v)) }
                }
            }
        }
        .environment(\.calendar, InsFmt.calendar)
        .environment(\.timeZone, InsFmt.tz)
        .frame(height: height)
        .accessibilityLabel("\(data.metric.name), \(InsFmt.range(data))")
    }

    private func tooltip(_ i: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(InsFmt.bucket(data, i)).font(.caption2).foregroundStyle(Color.textSecondary)
            ForEach(shown) { s in
                HStack(spacing: 6) {
                    Capsule().fill(InsColor.color(data.metric, s.key)).frame(width: 12, height: 3)
                    Text(InsFmt.num(s.values[i])).font(.caption.weight(.bold)).monospacedDigit()
                    Text(s.label).font(.caption2).foregroundStyle(Color.textSecondary).lineLimit(1)
                }
            }
            ForEach(data.eventsIn(i).prefix(2)) { e in
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 2).fill(e.isMaintenance ? InsColor.maintenance : InsColor.incident).frame(width: 9, height: 9)
                    Text(e.title).font(.caption2).lineLimit(1)
                }
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.surface3.opacity(0.97)))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.white.opacity(0.15), lineWidth: 1))
    }
}

// MARK: samenvatting = legenda

struct InsightsSummary: View {
    let data: InsightsData
    let off: Set<String>
    var detailed = true
    let toggle: (String) -> Void

    private var multi: Bool { data.series.filter(\.available).count > 1 }

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: data.series.count > 2 ? 100 : 140), spacing: 8)], alignment: .leading, spacing: 8) {
            ForEach(data.series) { s in
                let on = s.available && (!off.contains(s.key) || !multi)
                if multi {
                    Button { toggle(s.key) } label: { chip(s, on: on) }
                        .buttonStyle(.plain)
                        .disabled(!s.available)
                        .accessibilityValue(on ? "zichtbaar" : "verborgen")
                        .accessibilityHint("Tonen of verbergen in de grafiek")
                } else {
                    chip(s, on: true)
                }
            }
        }
    }

    private func chip(_ s: InsSeries, on: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Capsule()
                    .fill(on ? InsColor.color(data.metric, s.key) : Color.clear)
                    .overlay(Capsule().strokeBorder(on ? Color.clear : Color.textDim, lineWidth: 1.5))
                    .frame(width: 14, height: 4)
                Text(s.label + (s.agg == "avg" ? " (gem./dag)" : "")).font(.caption.weight(.semibold)).foregroundStyle(Color.textSecondary).lineLimit(1)
            }
            if !s.available {
                Text("alleen per dag").font(.caption).foregroundStyle(Color.textDim)
            } else {
                Text(InsFmt.num(s.main)).font(.title3.weight(.heavy)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                if let c = s.summary?.changePct { delta(c, key: s.key) }
                if detailed, let sm = s.summary {
                    Text("min \(InsFmt.num(sm.min)) · max \(InsFmt.num(sm.max)) · gem. \(InsFmt.num(sm.avg))")
                        .font(.caption2).foregroundStyle(Color.textDim).lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.04)))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.white.opacity(0.06), lineWidth: 1))
        .opacity(on ? 1 : 0.5)
    }

    private func delta(_ c: Double, key: String) -> some View {
        let up = c > 0, good = c == 0 ? nil : (up != (key == "failed"))
        return HStack(spacing: 3) {
            Image(systemName: c == 0 ? "arrow.right" : up ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill").font(.system(size: 8))
            Text("\(c > 0 ? "+" : "")\(InsFmt.num(c))%").font(.caption2.weight(.bold)).monospacedDigit()
            if detailed { Text("t.o.v. \(data.period.previous)").font(.caption2).foregroundStyle(Color.textDim).lineLimit(1) }
        }
        .foregroundStyle(good == nil ? Color.textDim : good! ? InsColor.good : InsColor.bad)
        .accessibilityElement(children: .combine)
    }
}

// MARK: periodekiezer en bladeren

struct InsightsPeriodBar: View {
    @Binding var period: InsPeriod
    @Binding var offset: Int
    var hasPrev: Bool

    var body: some View {
        HStack(spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 2) {
                    ForEach(InsPeriod.allCases) { p in
                        if p == .h24 { Divider().frame(height: 14).padding(.horizontal, 4) }
                        Button {
                            period = p
                            offset = 0
                        } label: {
                            Text(p.tab).font(.caption.weight(.semibold)).lineLimit(1)
                                .padding(.horizontal, 9).padding(.vertical, 5)
                                .foregroundStyle(p == period ? Color.black : Color.textSecondary)
                                .background(Capsule().fill(p == period ? Color.white : Color.clear))
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(p == period ? .isSelected : [])
                    }
                }
            }
            InsightsNav(offset: $offset, hasPrev: hasPrev)
        }
    }
}

struct InsightsNav: View {
    @Binding var offset: Int
    var hasPrev: Bool

    var body: some View {
        HStack(spacing: 4) {
            navButton("chevron.left", "Vorige periode", disabled: !hasPrev) { offset -= 1 }
            Button("Nu") { offset = 0 }
                .font(.caption.weight(.bold))
                .buttonStyle(.plain)
                .padding(.horizontal, 8).frame(height: 28)
                .background(RoundedRectangle(cornerRadius: 7).fill(Color.white.opacity(0.08)))
                .disabled(offset == 0).opacity(offset == 0 ? 0.35 : 1)
                .accessibilityLabel("Terug naar nu")
            navButton("chevron.right", "Volgende periode", disabled: offset == 0) { offset = min(0, offset + 1) }
        }
    }

    private func navButton(_ icon: String, _ label: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.caption.weight(.bold)).frame(width: 28, height: 28)
                .background(RoundedRectangle(cornerRadius: 7).fill(Color.white.opacity(0.08)))
        }
        .buttonStyle(.plain)
        .disabled(disabled).opacity(disabled ? 0.35 : 1)
        .accessibilityLabel(label)
    }
}

// MARK: widget op het overzicht

/// Insights-widget (type `insights`): eigen periode (bewaard in de indeling), bladeren (niet bewaard), series aan/uit.
struct InsightsWidgetView: View {
    let widget: DashWidget
    let title: String
    /// Vernieuwen op het overzicht
    let revision: Int
    let editing: Bool
    let update: (DashOptions) -> Void
    @Environment(Session.self) private var session
    @State private var offset = 0
    @State private var data: InsightsData?
    @State private var error: String?
    @State private var selection: Date?

    private var o: DashOptions { widget.options }
    private var metric: InsMetric { InsMetric(rawValue: o.insight ?? "") ?? .accounts }
    private var period: InsPeriod { InsPeriod(rawValue: o.period ?? "") ?? .d30 }
    private var off: Set<String> { Set(o.off ?? []) }
    private var events: Bool { o.events ?? true }
    private var taskKey: String { "\(InsightsCache.key(metric, period, offset, events))|\(revision)" }

    private var shown: [InsSeries] {
        guard let d = data else { return [] }
        let avail = d.series.filter(\.available)
        return avail.filter { !off.contains($0.key) || avail.count == 1 }
    }

    var body: some View {
        Group {
            if o.display == "number" || widget.size == .s { tile } else { full }
        }
        .task(id: taskKey) { await load() }
    }

    private var tile: some View {
        let s = shown.first ?? data?.series.first(where: \.available)
        return VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Color.textSecondary).lineLimit(1)
            if let s, let d = data {
                Text(InsFmt.num(s.main)).font(.system(size: 30, weight: .black)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.5)
                Text("\(s.label) · \(InsFmt.range(d).components(separatedBy: " · ")[0])").font(.caption).foregroundStyle(Color.textDim).lineLimit(1)
                if let c = s.summary?.changePct {
                    Text("\(c > 0 ? "▲ +" : c < 0 ? "▼ " : "→ ")\(InsFmt.num(c))%").font(.caption.weight(.bold))
                        .foregroundStyle(c == 0 ? Color.textDim : (c > 0) != (s.key == "failed") ? InsColor.good : InsColor.bad)
                }
            } else if let error {
                EmptyText(text: error)
            } else {
                RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.06)).frame(width: 90, height: 34)
            }
        }
    }

    private var full: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.headline).lineLimit(1)
                    Text(data.map(InsFmt.range) ?? " ").font(.caption).foregroundStyle(Color.textSecondary).lineLimit(1)
                }
                Spacer(minLength: 4)
                if !editing { InsightsNav(offset: $offset, hasPrev: data?.hasPrev ?? true) }
            }
            if !editing {
                InsightsPeriodBar(period: Binding(get: { period }, set: { p in
                    var n = o
                    n.period = p.rawValue
                    update(n)
                }), offset: $offset, hasPrev: data?.hasPrev ?? true)
            }
            if let d = data {
                InsightsSummary(data: d, off: off, detailed: widget.size == .l) { key in toggle(key, d) }
                InsightsChart(data: d, shown: shown, bars: bars(d), selection: $selection, height: widget.size == .l ? 210 : 120)
                    .frame(maxHeight: .infinity, alignment: .bottom)
            } else if let error {
                EmptyText(text: error)
            } else {
                skeleton
            }
        }
    }

    private var skeleton: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                ForEach(0..<2, id: \.self) { _ in RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.05)).frame(height: 54) }
            }
            RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.05)).frame(maxHeight: .infinity)
        }
        .accessibilityLabel("Laden")
    }

    private func bars(_ d: InsightsData) -> Bool {
        o.display == "bar" || (o.display != "line" && metric.autoBars(step: d.step))
    }

    private func toggle(_ key: String, _ d: InsightsData) {
        var cur = off
        if cur.contains(key) { cur.remove(key) } else {
            if d.series.filter({ $0.available && !cur.contains($0.key) }).count <= 1 { return }
            cur.insert(key)
        }
        var n = o
        n.off = metric.series.filter { cur.contains($0) }
        update(n)
    }

    private func load() async {
        do {
            let d = try await InsightsCache.load(session, metric, period, offset: offset, events: events)
            data = d
            error = nil
        } catch is CancellationError {
        } catch {
            if (error as? APIError)?.code == "auth" { return }
            self.error = (error as? APIError)?.code == "insights_not_configured"
                ? "Grafieken nog niet ingericht (workflow Backend in iptv-ios-appletv)." : APIError.text((error as? APIError)?.code ?? "server_error")
            data = nil
        }
    }
}

// MARK: onderdeel Insights

/// Bewaarde keuze van de tab Insights (UserDefaults "insightsPage", zelfde velden als localStorage bingrAdmin.insights).
struct InsightsPageState: Codable, Equatable {
    var sources: [InsMetric] = [.accounts, .streams]
    var period: InsPeriod = .d7
    var events = true
    var off: [String: [String]] = [:]

    static let key = "insightsPage"
    static func load() -> InsightsPageState {
        guard let data = UserDefaults.standard.string(forKey: key)?.data(using: .utf8),
              let s = try? JSONDecoder().decode(InsightsPageState.self, from: data) else { return InsightsPageState() }
        return s
    }
    func save() {
        if let d = try? JSONEncoder().encode(self), let t = String(data: d, encoding: .utf8) { UserDefaults.standard.set(t, forKey: Self.key) }
    }
}

/// Zoals Homey Insights: bronnen aanvinken (links, op de iPhone via een blad), één gedeelde periode, grafieken onder
/// elkaar met een gedeelde crosshair, en de zichtbare reeksen als CSV delen.
struct InsightsView: View {
    @Environment(Session.self) private var session
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var state = InsightsPageState.load()
    @State private var offset = 0
    @State private var results: [InsMetric: InsightsData] = [:]
    @State private var errors: [InsMetric: String] = [:]
    @State private var selection: Date?
    @State private var showSources = false
    @State private var revision = 0

    private var wide: Bool { sizeClass == .regular }
    private var taskKey: String { "\(state.sources.map(\.rawValue))|\(state.period.rawValue)|\(offset)|\(state.events)|\(revision)" }

    var body: some View {
        ScrollView {
            HStack(alignment: .top, spacing: 16) {
                if wide { sourcesPanel.frame(width: 250) }
                VStack(alignment: .leading, spacing: 14) {
                    periodPanel
                    if state.sources.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            CardHeader(title: "Geen bronnen gekozen", subtitle: "Kies één of meer bronnen om ze hier te vergelijken.")
                            Button("Bronnen kiezen") { showSources = true }.buttonStyle(.bingr)
                        }
                        .card()
                    }
                    ForEach(state.sources) { m in card(m) }
                }
            }
            .padding(16)
        }
        .screenBackground()
        .navigationTitle("Insights")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if let csv = csv {
                    ShareLink(item: csv, preview: SharePreview(csv.fileName)) { Label("Download CSV", systemImage: "square.and.arrow.up") }
                }
                if !wide {
                    Button { showSources = true } label: { Label("Bronnen", systemImage: "checklist") }
                }
            }
        }
        .sheet(isPresented: $showSources) {
            NavigationStack {
                Form { sourceRows }
                    .scrollContentBackground(.hidden)
                    .background(Color.surface1)
                    .navigationTitle("Bronnen")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Klaar") { showSources = false }.bold() } }
            }
            .presentationDetents([.medium, .large])
        }
        .refreshableCommand {
            await MainActor.run {
                InsightsCache.clear()
                revision += 1
            }
        }
        .task(id: taskKey) { await load() }
        .onChange(of: state) { state.save() }
    }

    private var csv: InsightsCSV? {
        InsightsCSV.make(state.sources.compactMap { m in results[m].map { ($0, Set(state.off[m.rawValue] ?? [])) } })
    }

    @ViewBuilder private var sourceRows: some View {
        Section {
            ForEach(InsMetric.allCases) { m in
                Toggle(isOn: Binding(get: { state.sources.contains(m) }, set: { on in
                    let set = Set(state.sources + [m]).subtracting(on ? [] : [m])
                    state.sources = InsMetric.allCases.filter { set.contains($0) }
                })) {
                    Label { VStack(alignment: .leading) { Text(m.name); Text(m.detail).font(.caption).foregroundStyle(Color.textDim) } }
                        icon: { Image(systemName: m.icon) }
                }
            }
        } footer: {
            Text("Alle grafieken volgen dezelfde periode.")
        }
        Section {
            Toggle("Storingen en onderhoud tonen", isOn: $state.events)
        }
    }

    private var sourcesPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            CardHeader(title: "Bronnen", subtitle: "Vink aan wat je wilt vergelijken")
            ForEach(InsMetric.allCases) { m in
                let on = state.sources.contains(m)
                Button {
                    let set = on ? Set(state.sources).subtracting([m]) : Set(state.sources + [m])
                    state.sources = InsMetric.allCases.filter { set.contains($0) }
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: on ? "checkmark.square.fill" : "square").font(.title3).foregroundStyle(on ? Color.white : Color.textDim)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(m.name).font(.subheadline.weight(.semibold))
                            Text(m.detail).font(.caption).foregroundStyle(Color.textDim)
                        }
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
            Divider()
            Toggle("Storingen en onderhoud", isOn: $state.events).font(.subheadline).tint(.bingrRed)
        }
        .card()
    }

    private var periodPanel: some View {
        let first = state.sources.compactMap { results[$0] }.first
        return VStack(alignment: .leading, spacing: 8) {
            Text(first.map(InsFmt.range) ?? state.period.long).font(.title3.weight(.bold)).lineLimit(2)
            InsightsPeriodBar(period: $state.period, offset: $offset, hasPrev: first?.hasPrev ?? true)
        }
        .card(padding: 14)
    }

    private func card(_ m: InsMetric) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(m.name).font(.headline)
                Spacer()
                if let d = results[m] { Text(d.resolution).font(.caption).foregroundStyle(Color.textDim) }
            }
            if let d = results[m] {
                let off = Set(state.off[m.rawValue] ?? [])
                let avail = d.series.filter(\.available)
                let shown = avail.filter { !off.contains($0.key) || avail.count == 1 }
                InsightsSummary(data: d, off: off, detailed: wide) { key in
                    var cur = off
                    if cur.contains(key) { cur.remove(key) } else if avail.filter({ !cur.contains($0.key) }).count > 1 { cur.insert(key) }
                    state.off[m.rawValue] = m.series.filter { cur.contains($0) }
                }
                InsightsChart(data: d, shown: shown, bars: m.autoBars(step: d.step), selection: $selection, height: wide ? 230 : 200)
            } else if let e = errors[m] {
                EmptyText(text: e)
            } else {
                RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.05)).frame(height: 230).accessibilityLabel("Laden")
            }
        }
        .card()
        .opacity(results[m] != nil && results[m]?.offset != offset ? 0.5 : 1)
    }

    private func load() async {
        let sources = state.sources, period = state.period, off = offset, ev = state.events
        await withTaskGroup(of: (InsMetric, Result<InsightsData, Error>).self) { group in
            for m in sources {
                group.addTask { @MainActor in
                    do { return (m, .success(try await InsightsCache.load(session, m, period, offset: off, events: ev))) }
                    catch { return (m, .failure(error)) }
                }
            }
            for await (m, r) in group {
                switch r {
                case .success(let d):
                    results[m] = d
                    errors[m] = nil
                case .failure(let e):
                    if e is CancellationError || (e as? APIError)?.code == "auth" { continue }
                    results[m] = nil
                    errors[m] = (e as? APIError)?.code == "insights_not_configured"
                        ? "Grafieken nog niet ingericht (workflow Backend in iptv-ios-appletv)." : APIError.text((e as? APIError)?.code ?? "server_error")
                }
            }
        }
    }
}
