import Charts
import SwiftUI

// Tab Omzet (zelfde als web/admin.js, loadRevenue): tegels met totalen, periodekiezer met bladeren zoals Insights,
// grafieken bruto/netto/opbrengst en aankopen met een gedeelde crosshair, van bruto naar opbrengst, verdeling per
// betaalmethode en land, het btw-uitgangspunt en de CSV-export (zonder persoonsgegevens).

/// Grafiek voor de omzet: lijnen of staven, ook negatieve waarden (opbrengst in een tijdvak met alleen een terugbetaling).
struct RevenueChart: View {
    let data: RevenueData
    let shown: [RevSeries]
    /// Kleur per serie: vaste volgorde van de kaart.
    let keys: [String]
    let bars: Bool
    @Binding var selection: Date?
    var height: CGFloat = 220

    private struct Pt: Identifiable {
        let id: String
        let key: String
        let date: Date
        let value: Double
    }

    private func color(_ key: String) -> Color {
        InsColor.palette[max(0, min(InsColor.palette.count - 1, keys.firstIndex(of: key) ?? 0))]
    }

    private var points: [Pt] {
        shown.flatMap { s in
            s.values.indices.compactMap { i -> Pt? in
                guard let v = s.values[i] else { return nil }
                return Pt(id: "\(s.key)-\(i)", key: s.key, date: data.mid(i), value: v)
            }
        }
    }

    private var money: Bool { shown.allSatisfy(\.money) }

    private var domain: ClosedRange<Double> {
        let vals = shown.flatMap { $0.values.compactMap { $0 } }
        let hi = max(1, vals.max() ?? 1), lo = min(0, vals.min() ?? 0)
        let raw = (hi - lo) / 4, p = pow(10, floor(log10(max(raw, 1))))
        let step = max(1, [1.0, 2, 5, 10].map { $0 * p }.first { $0 >= raw } ?? 10 * p)
        return (lo < 0 ? -ceil(-lo / step) * step : 0)...(ceil(hi / step) * step)
    }

    private var selectedIndex: Int? { selection.flatMap { data.index(of: $0) } }

    private var barUnit: Calendar.Component {
        switch data.step {
        case "hour": return .hour
        case "week": return .weekOfYear
        case "month": return .month
        default: return .day
        }
    }

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
        case "month":
            idx = (0..<n).filter { $0 % 2 == 0 }
        case "day" where n > 7:
            let k = [2, 5, 7, 10].first { (n + $0 - 1) / $0 <= 6 } ?? 10
            idx = (0..<n).filter { $0 % k == 0 }
        default:
            idx = Array(0..<n)
        }
        let atStart = data.step == "week" || (data.step == "hour" && n > 48)
        return idx.map { atStart ? data.start($0) : data.mid($0) }
    }

    var body: some View {
        if shown.isEmpty || !shown.contains(where: { $0.values.contains { ($0 ?? 0) != 0 } }) {
            VStack(spacing: 6) {
                Image(systemName: "chart.line.flattrend.xyaxis").font(.title2).foregroundStyle(Color.textDim)
                Text("Geen aankopen in deze periode").font(.subheadline.weight(.semibold)).foregroundStyle(Color.textSecondary)
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
            if bars {
                ForEach(points) { p in
                    BarMark(x: .value("Tijd", p.date, unit: barUnit), y: .value("Waarde", p.value))
                        .position(by: .value("Serie", p.key))
                        .foregroundStyle(color(p.key))
                        .cornerRadius(3)
                        .opacity(selectedIndex == nil || data.index(of: p.date) == selectedIndex ? 1 : 0.35)
                }
            } else {
                ForEach(points) { p in
                    AreaMark(x: .value("Tijd", p.date), y: .value("Waarde", p.value), series: .value("Serie", p.key), stacking: .unstacked)
                        .foregroundStyle(LinearGradient(colors: [color(p.key).opacity(0.22), color(p.key).opacity(0)], startPoint: .top, endPoint: .bottom))
                        .interpolationMethod(.monotone)
                }
                ForEach(points) { p in
                    LineMark(x: .value("Tijd", p.date), y: .value("Waarde", p.value), series: .value("Serie", p.key))
                        .foregroundStyle(color(p.key))
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                        .interpolationMethod(.monotone)
                }
            }
            if domain.lowerBound < 0 {
                RuleMark(y: .value("Nul", 0.0)).foregroundStyle(Color.white.opacity(0.25)).lineStyle(StrokeStyle(lineWidth: 1))
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
                            PointMark(x: .value("Tijd", data.mid(i)), y: .value("Waarde", v)).foregroundStyle(Color.surface1).symbolSize(120)
                            PointMark(x: .value("Tijd", data.mid(i)), y: .value("Waarde", v)).foregroundStyle(color(s.key)).symbolSize(50)
                        }
                    }
                }
            }
        }
        .chartXSelection(value: $selection)
        .chartXScale(domain: data.from...data.to)
        .chartYScale(domain: domain)
        .chartLegend(.hidden)
        .chartXAxis {
            AxisMarks(values: ticks) { value in
                AxisTick().foregroundStyle(Color.clear)
                AxisValueLabel {
                    if let d = value.as(Date.self) { Text(data.axis(d)) }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
                AxisGridLine().foregroundStyle(Color.white.opacity(0.07))
                AxisValueLabel {
                    if let v = value.as(Double.self) { Text(money ? "€ \(InsFmt.compact(v / 100))" : InsFmt.compact(v)) }
                }
            }
        }
        .environment(\.calendar, InsFmt.calendar)
        .environment(\.timeZone, InsFmt.tz)
        .frame(height: height)
        .accessibilityLabel("Omzet, \(data.rangeText)")
    }

    private func tooltip(_ i: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(data.bucketText(i)).font(.caption2).foregroundStyle(Color.textSecondary)
            ForEach(shown) { s in
                HStack(spacing: 6) {
                    Capsule().fill(color(s.key)).frame(width: 12, height: 3)
                    Text(s.format(s.values[i])).font(.caption.weight(.bold)).monospacedDigit()
                    Text(s.label).font(.caption2).foregroundStyle(Color.textSecondary).lineLimit(1)
                }
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.surface3.opacity(0.97)))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.white.opacity(0.15), lineWidth: 1))
    }
}

/// Samenvatting per serie (= legenda, aan/uit), zoals InsightsSummary maar met bedragen.
struct RevenueSummary: View {
    let data: RevenueData
    let keys: [String]
    let off: Set<String>
    let toggle: (String) -> Void

    var body: some View {
        let list = data.series(keys)
        LazyVGrid(columns: [GridItem(.adaptive(minimum: list.count > 2 ? 104 : 140), spacing: 8)], alignment: .leading, spacing: 8) {
            ForEach(list) { s in
                let on = !off.contains(s.key) || list.count == 1
                Button { toggle(s.key) } label: { chip(s, on: on) }
                    .buttonStyle(.plain)
                    .accessibilityValue(on ? "zichtbaar" : "verborgen")
                    .accessibilityHint("Tonen of verbergen in de grafiek")
            }
        }
    }

    private func chip(_ s: RevSeries, on: Bool) -> some View {
        let i = keys.firstIndex(of: s.key) ?? 0
        let c = InsColor.palette[min(i, InsColor.palette.count - 1)]
        return VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Capsule().fill(on ? c : Color.clear)
                    .overlay(Capsule().strokeBorder(on ? Color.clear : Color.textDim, lineWidth: 1.5))
                    .frame(width: 14, height: 4)
                Text(s.label).font(.caption.weight(.semibold)).foregroundStyle(Color.textSecondary).lineLimit(1)
            }
            Text(s.format(s.summary?.total)).font(.title3.weight(.heavy)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
            if let ch = s.summary?.changePct {
                let up = ch > 0, good = ch == 0 ? nil : (up != s.down)
                HStack(spacing: 3) {
                    Image(systemName: ch == 0 ? "arrow.right" : up ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill").font(.system(size: 8))
                    Text("\(ch > 0 ? "+" : "")\(InsFmt.num(ch))%").font(.caption2.weight(.bold)).monospacedDigit()
                    Text("t.o.v. \(data.period.previous)").font(.caption2).foregroundStyle(Color.textDim).lineLimit(1)
                }
                .foregroundStyle(good == nil ? Color.textDim : good! ? InsColor.good : InsColor.bad)
            } else {
                Text("geen vergelijking").font(.caption2).foregroundStyle(Color.textDim)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.04)))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.white.opacity(0.06), lineWidth: 1))
        .opacity(on ? 1 : 0.5)
    }
}

struct RevenueView: View {
    @Environment(Session.self) private var session
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var state = RevenuePageState.load()
    @State private var offset = 0
    @State private var data: RevenueData?
    @State private var error: String?
    @State private var loading = false
    @State private var selection: Date?
    @State private var revision = 0
    @State private var csv: InsightsCSV?
    @State private var exporting = false
    @State private var rateText = ""
    @State private var busy = false

    private static let moneyKeys = ["gross", "net", "proceeds"]
    private static let countKeys = ["count", "refund_count"]
    private var wide: Bool { sizeClass == .regular }
    private var taskKey: String { "\(state.period.rawValue)|\(state.bucket)|\(state.mode.rawValue)|\(offset)|\(revision)" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let error, data == nil {
                    VStack(alignment: .leading, spacing: 6) {
                        CardHeader(title: "Omzet niet beschikbaar")
                        EmptyText(text: error)
                    }
                    .card()
                } else if let d = data {
                    tiles(d)
                    if d.empty { emptyCard(d) } else { content(d) }
                    basis(d)
                } else {
                    RoundedRectangle(cornerRadius: 16).fill(Color.white.opacity(0.05)).frame(height: 120)
                    RoundedRectangle(cornerRadius: 16).fill(Color.white.opacity(0.05)).frame(height: 300)
                }
            }
            .padding(16)
        }
        .screenBackground()
        .navigationTitle("Omzet")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if let csv {
                    ShareLink(item: csv, preview: SharePreview(csv.fileName)) { Label("Deel CSV", systemImage: "square.and.arrow.up") }
                } else {
                    Button { Task { await exportCsv() } } label: { Label("CSV maken", systemImage: "tablecells") }
                        .disabled(exporting || data == nil || data?.empty == true)
                }
                Menu {
                    Picker("Aankopen", selection: $state.mode) {
                        ForEach(RevMode.allCases) { m in Text(modeTitle(m)).tag(m) }
                    }
                } label: { Label("Live of test", systemImage: "line.3.horizontal.decrease.circle") }
            }
        }
        .refreshableCommand {
            await MainActor.run { revision += 1 }
        }
        .task(id: taskKey) { await load() }
        .onChange(of: state) { state.save() }
        .onChange(of: state.mode) { offset = 0 }
    }

    private func modeTitle(_ m: RevMode) -> String {
        guard let d = data else { return m.title }
        switch m {
        case .auto: return "\(m.title) (\(d.mode == "all" ? "alles" : d.mode))"
        case .live: return "\(m.title) (\(d.liveCount))"
        case .test: return "\(m.title) (\(d.testCount))"
        case .all: return "\(m.title) (\(d.liveCount + d.testCount))"
        }
    }

    // MARK: tegels

    private func tiles(_ d: RevenueData) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: wide ? 4 : 2), spacing: 12) {
            tile("Deze maand", d.total("month"))
            tile("Vorige maand", d.total("prev_month"))
            tile("Dit jaar", d.total("year"))
            tile("Totaal", d.total("all"))
        }
    }

    private func tile(_ label: String, _ t: RevTotals?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.subheadline.weight(.semibold)).foregroundStyle(Color.textSecondary)
            Text(Fmt.euro(t?.gross)).font(.system(size: wide ? 28 : 22, weight: .black)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
            Text("netto \(Fmt.euro(t?.net))").font(.caption).foregroundStyle(Color.textDim).lineLimit(1)
            Text("opbrengst \(Fmt.euro(t?.proceeds))").font(.caption.weight(.semibold))
                .foregroundStyle((t?.proceeds ?? 0) < 0 ? InsColor.bad : Color.white).lineLimit(1)
            Text("\(Fmt.num(t?.count)) \(t?.count == 1 ? "aankoop" : "aankopen")").font(.caption).foregroundStyle(Color.textDim).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
        .accessibilityElement(children: .combine)
    }

    private func emptyCard(_ d: RevenueData) -> some View {
        VStack(spacing: 8) {
            Image(systemName: "eurosign.circle").font(.largeTitle).foregroundStyle(Color.textDim)
            Text("Nog geen aankopen").font(.headline)
            Text(d.billingEnabled
                 ? "Betalen staat aan (\(d.billingMode == "live" ? "live" : "testmodus")). Zodra iemand Lifetime koopt op bingr.online/upgrade/, verschijnt de omzet hier."
                 : "Betalen staat uit: er is geen STRIPE_SECRET_KEY (GitHub-secret in iptv-ios-appletv, workflow Backend).")
                .font(.subheadline).foregroundStyle(Color.textSecondary).multilineTextAlignment(.center)
            if d.mode != "all" && d.liveCount + d.testCount > 0 {
                Button("Live en test tonen") { state.mode = .all }.buttonStyle(.bingrGhost)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .card()
    }

    // MARK: grafieken en verdeling

    @ViewBuilder private func content(_ d: RevenueData) -> some View {
        periodPanel(d)
        let moneyCard = card(d, title: "Omzet", keys: Self.moneyKeys, off: Set(state.offMoney), bars: state.bars, showKind: true) { key in
            state.offMoney = toggled(state.offMoney, key, keys: Self.moneyKeys)
        }
        let countCard = card(d, title: "Aankopen", keys: Self.countKeys, off: Set(state.offCount), bars: true, showKind: false) { key in
            state.offCount = toggled(state.offCount, key, keys: Self.countKeys)
        }
        if wide {
            HStack(alignment: .top, spacing: 14) { moneyCard; countCard }
            HStack(alignment: .top, spacing: 14) {
                breakCard(d)
                VStack(spacing: 14) {
                    shares("Per betaalmethode", d.byMethod)
                    shares("Per land", d.byCountry)
                }
            }
        } else {
            moneyCard
            countCard
            breakCard(d)
            shares("Per betaalmethode", d.byMethod)
            shares("Per land", d.byCountry)
        }
    }

    private func toggled(_ cur: [String], _ key: String, keys: [String]) -> [String] {
        var s = Set(cur)
        if s.contains(key) { s.remove(key) } else if keys.filter({ !s.contains($0) }).count > 1 { s.insert(key) }
        return keys.filter { s.contains($0) }
    }

    private func periodPanel(_ d: RevenueData) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(d.rangeText).font(.title3.weight(.bold)).lineLimit(2)
                    Text(d.resolution.capitalizedFirst).font(.caption).foregroundStyle(Color.textDim)
                }
                Spacer(minLength: 4)
                InsightsNav(offset: $offset, hasPrev: d.hasPrev)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 2) {
                    ForEach(RevPeriod.allCases) { p in
                        if p == .d7 { Divider().frame(height: 14).padding(.horizontal, 4) }
                        pill(p.tab, on: p == state.period) {
                            state.period = p
                            state.bucket = "auto"
                            offset = 0
                        }
                    }
                }
            }
            if state.period.buckets.count > 1 {
                let cur = state.period.buckets.contains(state.bucket) ? state.bucket : state.period.buckets[0]
                HStack(spacing: 2) {
                    ForEach(state.period.buckets, id: \.self) { b in
                        pill(["hour": "Per uur", "day": "Per dag", "week": "Per week", "month": "Per maand"][b] ?? b, on: b == cur) {
                            state.bucket = b == state.period.buckets[0] ? "auto" : b
                        }
                    }
                }
            }
        }
        .card(padding: 14)
        .opacity(loading ? 0.7 : 1)
    }

    private func pill(_ text: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text).font(.caption.weight(.semibold)).lineLimit(1)
                .padding(.horizontal, 9).padding(.vertical, 5)
                .foregroundStyle(on ? Color.black : Color.textSecondary)
                .background(Capsule().fill(on ? Color.white : Color.clear))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func card(_ d: RevenueData, title: String, keys: [String], off: Set<String>, bars: Bool, showKind: Bool,
                      toggle: @escaping (String) -> Void) -> some View {
        let list = d.series(keys).filter(\.available)
        let shown = list.filter { !off.contains($0.key) || list.count == 1 }
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.headline)
                Spacer()
                if showKind {
                    HStack(spacing: 2) {
                        pill("Lijnen", on: !state.bars) { state.bars = false }
                        pill("Staven", on: state.bars) { state.bars = true }
                    }
                } else {
                    Text(d.resolution).font(.caption).foregroundStyle(Color.textDim)
                }
            }
            RevenueSummary(data: d, keys: keys, off: off, toggle: toggle)
            RevenueChart(data: d, shown: shown, keys: keys, bars: bars, selection: $selection, height: wide ? 240 : 200)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .opacity(loading ? 0.6 : 1)
    }

    private func breakCard(_ d: RevenueData) -> some View {
        let t = d.total("period"), p = d.total("prev_period")
        func neg(_ v: Int?) -> String { (v ?? 0) == 0 ? Fmt.euro(0) : "− \(Fmt.euro(v))" }
        return VStack(alignment: .leading, spacing: 0) {
            CardHeader(title: "Van bruto naar opbrengst", subtitle: "Deze periode · rechts \(d.period.previous)")
                .padding(.bottom, 8)
            row("Aankopen", Fmt.num(t?.count), Fmt.num(p?.count))
            row("Bruto omzet", Fmt.euro(t?.gross), Fmt.euro(p?.gross), hint: "incl. btw")
            row("Btw", neg(t?.vat), neg(p?.vat))
            row("Netto omzet", Fmt.euro(t?.net), Fmt.euro(p?.net), hint: "excl. btw", strong: true)
            row("Stripe-kosten", neg(t?.fees), neg(p?.fees), hint: (t?.missingFees ?? 0) > 0 ? "\(Fmt.num(t?.missingFees)) nog onbekend" : nil)
            row("Terugbetaald / chargebacks", neg(t?.refundsNet), neg(p?.refundsNet), hint: "excl. btw; incl. btw \(Fmt.euro(t?.refunds))")
            row("Netto opbrengst", Fmt.euro(t?.proceeds), Fmt.euro(p?.proceeds), strong: true, last: true,
                bad: (t?.proceeds ?? 0) < 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func row(_ label: String, _ a: String, _ b: String, hint: String? = nil, strong: Bool = false, last: Bool = false, bad: Bool = false) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(label).font(last ? .headline : .subheadline.weight(strong ? .bold : .regular))
                        .foregroundStyle(strong || last ? Color.white : Color.textSecondary)
                    if let hint { Text(hint).font(.caption2).foregroundStyle(Color.textDim) }
                }
                Spacer(minLength: 4)
                Text(a).font(last ? .headline.weight(.heavy) : .subheadline.weight(strong ? .bold : .medium)).monospacedDigit()
                    .foregroundStyle(bad ? InsColor.bad : Color.white)
                Text(b).font(.caption).monospacedDigit().foregroundStyle(Color.textDim).frame(minWidth: 70, alignment: .trailing)
            }
            .padding(.vertical, 8)
            if !last { Divider().overlay(Color.white.opacity(0.08)) }
        }
        .accessibilityElement(children: .combine)
    }

    private func shares(_ title: String, _ list: [RevShare]) -> some View {
        let max = Double(list.map(\.gross).max() ?? 1)
        return VStack(alignment: .leading, spacing: 8) {
            CardHeader(title: title, subtitle: "Bruto in deze periode")
            if list.isEmpty {
                EmptyText(text: "Geen aankopen in deze periode.")
            }
            ForEach(list.prefix(10)) { r in
                HStack(spacing: 10) {
                    Text(r.label).font(.subheadline).lineLimit(1).frame(width: 110, alignment: .leading)
                    GeometryReader { g in
                        Capsule().fill(Color.white.opacity(0.07))
                            .overlay(alignment: .leading) {
                                Capsule().fill(Color.bingrRed).frame(width: Swift.max(4, g.size.width * Double(r.gross) / Swift.max(1, max)))
                            }
                    }
                    .frame(height: 8)
                    Text(Fmt.euro(r.gross)).font(.caption.weight(.semibold)).monospacedDigit()
                    Text("\(r.count)×").font(.caption2).foregroundStyle(Color.textDim).monospacedDigit()
                }
                .accessibilityElement(children: .combine)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    // MARK: btw en kosten

    private func basis(_ d: RevenueData) -> some View {
        let missing = d.total("all")?.missingFees ?? 0
        return VStack(alignment: .leading, spacing: 8) {
            Text(d.vatText + ".").font(.subheadline.weight(.bold))
            Text(d.vatNote).font(.caption).foregroundStyle(Color.textSecondary)
            Text("Netto opbrengst = netto omzet − Stripe-kosten − terugbetalingen en chargebacks (excl. btw). Aankopen tellen op de betaaldatum, terugbetalingen op hun eigen datum.")
                .font(.caption).foregroundStyle(Color.textDim)
            if d.vatSource != "stripe_tax" {
                HStack(spacing: 8) {
                    Text("Btw-tarief").font(.subheadline)
                    TextField("21", text: $rateText)
                        .keyboardType(.decimalPad)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 70)
                    Text("%").foregroundStyle(Color.textSecondary)
                    Button("Opslaan") { Task { await saveRate() } }
                        .buttonStyle(.bingrGhost)
                        .disabled(busy || rateText.isEmpty)
                }
                .padding(.top, 4)
            }
            if missing > 0 {
                Text("\(Fmt.num(missing)) \(missing == 1 ? "aankoop" : "aankopen") zonder Stripe-kosten.").font(.caption).foregroundStyle(Color.textDim)
                if d.billingEnabled {
                    Button("Kosten ophalen bij Stripe") { Task { await backfill() } }
                        .buttonStyle(.bingrGhost)
                        .disabled(busy)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    // MARK: laden en acties

    private func load() async {
        loading = true
        defer { loading = false }
        csv = nil
        var params = state.params
        params["offset"] = offset
        do {
            let j = try await session.call("revenue", params)
            guard let d = RevenueData(j, period: state.period) else { throw APIError(code: "server_error", status: 200, body: j) }
            data = d
            error = nil
            if rateText.isEmpty || !busy { rateText = InsFmt.num(d.vatRate) }
        } catch is CancellationError {
        } catch {
            if (error as? APIError)?.code == "auth" { return }
            self.error = APIError.text((error as? APIError)?.code ?? "server_error")
            data = nil
        }
    }

    private func exportCsv() async {
        exporting = true
        defer { exporting = false }
        var params = state.params
        params["offset"] = offset
        do {
            let j = try await session.call("revenue_export", params)
            let text = (j["csv"].text ?? "").replacingOccurrences(of: "\u{FEFF}", with: "")
            csv = InsightsCSV(text: text, fileName: j["file_name"].text ?? "bingr-omzet.csv")
            session.show("CSV klaar (\(Fmt.num(j["rows"].int)) regels, zonder persoonsgegevens). Tik op Deel CSV.")
        } catch { session.report(error) }
    }

    private func saveRate() async {
        guard let rate = Double(rateText.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)) else {
            session.show(APIError.text("bad_rate"), bad: true)
            return
        }
        busy = true
        defer { busy = false }
        do {
            let r = try await session.call("revenue_vat_set", ["rate": rate])
            session.show("Btw-tarief \(InsFmt.num(r["rate"].double ?? rate))% opgeslagen.")
            revision += 1
        } catch { session.report(error) }
    }

    private func backfill() async {
        busy = true
        defer { busy = false }
        do {
            let r = try await session.call("revenue_backfill")
            let n = r["updated"].int ?? 0, rest = r["remaining"].int ?? 0
            session.show(n > 0 ? "Stripe-kosten van \(n) \(n == 1 ? "aankoop" : "aankopen") opgehaald\(rest > 0 ? ", nog \(rest)" : "")."
                         : "Nog geen nieuwe kosten bij Stripe (soms pas na een paar dagen).")
            revision += 1
        } catch { session.report(error) }
    }
}
