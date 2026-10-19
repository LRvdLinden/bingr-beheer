import SwiftUI

/// Gegevens voor het dashboard: `stats` altijd, `status` (op overview), `push_history` en `push_subscribers` alleen als
/// een zichtbare widget ze nodig heeft. Support-tellers komen uit de sessie.
struct DashData {
    var stats: Stats?
    var statsError: String?
    var status: StatusOverview?
    /// operational, maintenance, degraded, partial of major (zoals overall.level van `status`)
    var statusLevel = "operational"
    var statusAffected: [String] = []
    var statusError: String?
    /// Laatste pushmeldingen (push_history, eerste bladzijde)
    var pushHistory: [PushMessage]?
    var pushHistoryError: String?
    /// Pushabonnees (push_subscribers)
    var pushSubscribers: PushSubscribers?
    var pushSubscribersError: String?
    /// Nieuwsbrief (newsletter_status): abonnees en of hij aan staat
    var newsletter: NewsletterStatus?
    var newsletterError: String?
    /// Verhoogd bij elke keer vernieuwen: de Insights-grafieken laden dan opnieuw (eigen actie insights per widget)
    var insightsRevision = 0

    /// Platforms die in de gegevens voorkomen (keuzelijst bij Apparaten per platform en App-versies).
    var knownPlatforms: [String] {
        var seen = Set<String>()
        let all = (stats?.platforms ?? []).map(\.platform) + (stats?.versions ?? []).map(\.platform) + (status?.devices ?? []).map(\.platform)
        return all.filter { !$0.isEmpty && seen.insert($0).inserted }
    }
}

/// Waar een tik op een widget naartoe gaat.
enum DashTarget {
    case users(String)
    case support(String)
    case status
    case messages
    case newsletter
}

enum DashText {
    static func title(_ w: DashWidget, stats: Stats?) -> String {
        let o = w.options
        switch w.type {
        case .metric: return o.metricValue.label
        case .insights: return (InsMetric(rawValue: o.insight ?? "") ?? .accounts).name
        case .platforms: return o.source == "live" ? "Nu actieve apparaten" : "Actieve apparaten per platform"
        case .versions: return "App-versies in gebruik"
        case .plans: return "Abonnementen"
        case .support: return o.statusList == ["new", "open", "pending"] ? "Open tickets" : "Supporttickets"
        case .status: return "Servicestatus"
        case .announcements: return "Laatste pushmeldingen"
        case .pushSubscribers: return "Pushabonnees"
        case .newsletter: return "Nieuwsbrief"
        }
    }

    static func supportFilter(for statuses: [String]) -> String {
        if statuses == ["new", "open", "pending"] { return "active" }
        return statuses.count == 1 ? statuses[0] : "all"
    }

    static func levelText(_ level: String) -> String {
        ["major": "Grote storing", "partial": "Gedeeltelijke storing", "degraded": "Verminderd", "maintenance": "Onderhoud"][level]
            ?? "Alle systemen werken"
    }

    static func levelColor(_ level: String) -> Color {
        switch level {
        case "major": return .stateDown
        case "partial": return Color(hex: 0xFF7A1A)
        case "degraded": return .stateDegraded
        case "maintenance": return Color(hex: 0x4C8DFF)
        default: return .stateUp
        }
    }

    static let planNames = ["free": "Gratis", "lifetime": "Lifetime", "custom": "Eigen limieten"]
}

// MARK: raster

/// Grootte van een kind in `DashGridLayout`.
struct DashSpanKey: LayoutValueKey {
    static let defaultValue = DashSpan(columns: 1, rows: 1)
}

/// Raster met vaste rijhoogte: S = 1×1, M = 2×1, L = 2×2 (Insights-grafieken M = 2×2, L = 2×3). Plaatst elke widget op de eerste vrije plek (zoals
/// `grid-auto-flow: row dense` op het web), zodat er geen gaten vallen. (LazyVGrid kent geen kolom- en rij-spans.)
struct DashGridLayout: Layout {
    var columns: Int
    var rowHeight: CGFloat = 150
    var spacing: CGFloat = 12

    private struct Cell {
        let col: Int
        let row: Int
        let width: Int
        let height: Int
    }

    private func pack(_ sizes: [DashSpan]) -> (cells: [Cell], rows: Int) {
        let cols = max(1, columns)
        var grid: [[Bool]] = []
        var cells: [Cell] = []
        func fits(_ r: Int, _ c: Int, _ w: Int, _ h: Int) -> Bool {
            for rr in r..<(r + h) where rr < grid.count {
                for cc in c..<(c + w) where grid[rr][cc] { return false }
            }
            return true
        }
        for size in sizes {
            let w = min(size.columns, cols), h = max(1, size.rows)
            var row = 0
            var placed = false
            while !placed {
                for c in 0...(cols - w) where fits(row, c, w, h) {
                    while grid.count < row + h { grid.append(Array(repeating: false, count: cols)) }
                    for rr in row..<(row + h) { for cc in c..<(c + w) { grid[rr][cc] = true } }
                    cells.append(Cell(col: c, row: row, width: w, height: h))
                    placed = true
                    break
                }
                if !placed { row += 1 }
            }
        }
        return (cells, grid.count)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = pack(subviews.map { $0[DashSpanKey.self] }).rows
        let width = proposal.replacingUnspecifiedDimensions(by: CGSize(width: 600, height: 0)).width
        return CGSize(width: width, height: rows > 0 ? CGFloat(rows) * rowHeight + CGFloat(rows - 1) * spacing : 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let cols = max(1, columns)
        let colWidth = (bounds.width - CGFloat(cols - 1) * spacing) / CGFloat(cols)
        let cells = pack(subviews.map { $0[DashSpanKey.self] }).cells
        for (view, cell) in zip(subviews, cells) {
            let w = CGFloat(cell.width) * colWidth + CGFloat(cell.width - 1) * spacing
            let h = CGFloat(cell.height) * rowHeight + CGFloat(cell.height - 1) * spacing
            view.place(at: CGPoint(x: bounds.minX + CGFloat(cell.col) * (colWidth + spacing),
                                   y: bounds.minY + CGFloat(cell.row) * (rowHeight + spacing)),
                       anchor: .topLeading, proposal: ProposedViewSize(width: w, height: h))
        }
    }
}

// MARK: kaart

/// Eén widget als kaart. Buiten de wijzigmodus is de kaart een knop als hij ergens naartoe gaat.
struct DashWidgetCard: View {
    let widget: DashWidget
    let data: DashData
    let support: SupportCounts?
    let editing: Bool
    let open: (DashTarget) -> Void
    /// Opties van de widget wijzigen zonder de wijzigmodus (Insights: periode en series aan/uit)
    var update: (DashOptions) -> Void = { _ in }

    private var o: DashOptions { widget.options }
    private var title: String { DashText.title(widget, stats: data.stats) }

    var body: some View {
        let card = content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .clipped()
            .padding(14)
            .background(CardBackground(highlight: highlight))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        if let destination = target, !editing {
            Button { open(destination) } label: { card }
                .buttonStyle(.plain)
                .accessibilityHint("Openen")
        } else {
            card.accessibilityElement(children: .combine)
        }
    }

    // MARK: doel en accent

    private var target: DashTarget? {
        switch widget.type {
        case .metric:
            guard let f = o.metricValue.usersFilter, metricValue != nil else { return nil }
            return .users(f)
        case .plans: return .users(widget.size == .s ? (o.planList.first ?? "") : "")
        case .support: return .support(DashText.supportFilter(for: o.statusList))
        case .status: return .status
        case .announcements, .pushSubscribers: return .messages
        case .newsletter: return .newsletter
        default: return nil
        }
    }

    private var highlight: Color? {
        switch widget.type {
        case .metric:
            if o.metricValue == .blocked, (metricValue ?? 0) > 0 { return .bad }
            if o.metricValue == .watchingNow, (metricValue ?? 0) > 0 { return .ok }
            return nil
        case .support: return (support?.unread ?? 0) > 0 ? .bingrRed : nil
        case .status: return data.statusLevel == "operational" || data.status == nil ? nil : DashText.levelColor(data.statusLevel)
        default: return nil
        }
    }

    private var metricValue: Int? {
        guard let s = data.stats else { return nil }
        switch o.metricValue {
        case .usersTotal: return s.totalUsers
        case .usersNew7d: return s.newUsers7d
        case .activeToday: return s.activeToday
        case .active30d: return s.active30d
        case .devices: return s.devicesTotal
        case .watchingNow: return s.watchingNow
        case .blocked: return s.blockedUsers
        case .planFree: return s.planFree
        case .planLifetime: return s.planLifetime
        case .planCustom: return s.planCustom
        case .optedOut: return s.optedOut
        case .purchases: return s.purchasesPaid
        case .revenue: return s.revenueCents
        }
    }

    // MARK: inhoud

    private var needsStats: Bool {
        switch widget.type {
        case .support, .status, .announcements, .pushSubscribers, .insights: return false
        case .platforms: return o.source != "live"
        default: return true
        }
    }

    @ViewBuilder private var content: some View {
        if needsStats && data.stats == nil {
            placeholder(data.statsError)
        } else {
            switch widget.type {
            case .metric: metricView
            case .insights:
                InsightsWidgetView(widget: widget, title: title, revision: data.insightsRevision, editing: editing, update: update)
            case .platforms, .versions: barsView
            case .plans: plansView
            case .support: supportView
            case .status: statusView
            case .announcements: pushHistoryView
            case .pushSubscribers: pushSubscribersView
            case .newsletter: newsletterView
            }
        }
    }

    private func placeholder(_ error: String?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            head(nil)
            if let error { EmptyText(text: error) } else { ProgressView().frame(maxWidth: .infinity, alignment: .leading) }
        }
    }

    private func head(_ subtitle: String?, trailing: String? = nil) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline).lineLimit(1)
                if let subtitle, widget.size != .m {
                    Text(subtitle).font(.caption).foregroundStyle(Color.textDim).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if let trailing {
                Text(trailing).font(.subheadline.weight(.bold)).monospacedDigit().lineLimit(1)
            }
        }
    }

    private func tile(_ label: String, _ value: String, _ hint: String, valueColor: Color = .white, hintColor: Color = .textDim) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.subheadline.weight(.semibold)).foregroundStyle(Color.textSecondary).lineLimit(1)
            Text(value)
                .font(.system(size: widget.size == .s ? 30 : 36, weight: .black))
                .monospacedDigit()
                .foregroundStyle(valueColor)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            if !hint.isEmpty {
                Text(hint).font(.caption).foregroundStyle(hintColor).lineLimit(2)
            }
        }
    }

    // Kengetal
    @ViewBuilder private var metricView: some View {
        let s = data.stats
        let m = o.metricValue
        if let v = metricValue {
            let hint: String = {
                switch m {
                case .usersTotal: return "\(Fmt.num(s?.confirmedUsers)) bevestigd"
                case .devices: return "gekoppeld"
                case .watchingNow: return "streams"
                case .planLifetime: return (s?.planCustom ?? 0) > 0 ? "\(Fmt.num(s?.planCustom)) met eigen limieten" : "accounts"
                case .optedOut: return "afgemeld"
                case .purchases: return (s?.purchasesRefunded ?? 0) > 0 ? "\(Fmt.num(s?.purchasesRefunded)) terugbetaald" : "Lifetime gekocht"
                case .revenue: return "betaald, zonder terugbetalingen"
                default: return "accounts"
                }
            }()
            let color: Color = m == .watchingNow ? .ok : m == .planLifetime ? Color(hex: 0xFFD54A)
                : (m == .blocked && v > 0) ? Color(hex: 0xFF8A8F) : .white
            tile(title, m == .revenue ? Fmt.euro(v) : Fmt.num(v), hint, valueColor: color)
        } else {
            tile(title, "—", "niet beschikbaar")
        }
    }

    // Apparaten per platform / App-versies
    @ViewBuilder private var barsView: some View {
        let live = widget.type == .platforms && o.source == "live"
        if live && data.status == nil {
            placeholder(data.statusError)
        } else {
            let filter = o.platformList
            let keep: (String) -> Bool = { filter.isEmpty || filter.contains($0) }
            let rows: [HBarList.Row] = {
                if widget.type == .versions {
                    return (data.stats?.versions ?? []).filter { keep($0.platform) }.map {
                        .init(label: $0.version == "?" ? "onbekend" : ($0.version ?? "onbekend"), detail: Labels.platform($0.platform), value: $0.devices)
                    }
                }
                if live {
                    return (data.status?.devices ?? []).filter { keep($0.platform) }.map {
                        .init(label: Labels.platform($0.platform), icon: Labels.platformIcon($0.platform), value: $0.devices)
                    }
                }
                return (data.stats?.platforms ?? []).filter { keep($0.platform) }.map {
                    .init(label: Labels.platform($0.platform), icon: Labels.platformIcon($0.platform), value: $0.devices)
                }
            }()
            let sub = (live ? "Gezien in de laatste 15 minuten" : widget.type == .versions ? "Per platform, laatste 30 dagen" : "Gezien in de laatste 30 dagen")
                + (filter.isEmpty ? "" : " · " + filter.map { Labels.platform($0) }.joined(separator: ", "))
            VStack(alignment: .leading, spacing: 10) {
                head(sub)
                HBarList(rows: rows, limit: widget.size == .l ? 7 : 3)
            }
        }
    }

    // Abonnementen
    @ViewBuilder private var plansView: some View {
        let s = data.stats
        if s?.planLifetime == nil {
            VStack(alignment: .leading, spacing: 8) { head(nil); EmptyText(text: "Niet beschikbaar (ouder databaseschema).") }
        } else {
            let value: (String) -> Int = { k in k == "free" ? (s?.planFree ?? 0) : k == "lifetime" ? (s?.planLifetime ?? 0) : (s?.planCustom ?? 0) }
            let plans = o.planList
            if widget.size == .s, let first = plans.first {
                tile("\(title) · \(DashText.planNames[first] ?? first)", Fmt.num(value(first)),
                     plans.dropFirst().map { "\(Fmt.num(value($0))) \(DashText.planNames[$0] ?? $0)" }.joined(separator: " · "),
                     valueColor: first == "lifetime" ? Color(hex: 0xFFD54A) : .white)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    head("Accounts per abonnement")
                    if widget.size == .m {
                        HStack(spacing: 6) {
                            ForEach(plans, id: \.self) { k in planCell(DashText.planNames[k] ?? k, value(k), gold: k == "lifetime") }
                        }
                    } else {
                        VStack(spacing: 6) {
                            ForEach(plans, id: \.self) { k in planCell(DashText.planNames[k] ?? k, value(k), gold: k == "lifetime") }
                        }
                    }
                }
            }
        }
    }

    // Supporttickets
    @ViewBuilder private var supportView: some View {
        let c = support
        let unread = c?.unread ?? 0
        let statuses = o.statusList
        let sum = c.map { cc in statuses.reduce(0) { $0 + (cc.count(for: $1) ?? 0) } }
        if o.display == "number" || widget.size == .s {
            tile(title, sum.map { Fmt.num($0) } ?? "—", c?.hint ?? "support",
                 hintColor: unread > 0 ? Color(hex: 0xFF8A8F) : .textDim)
        } else if let c {
            let shown = Array(statuses.prefix(widget.size == .m ? 2 : 5))
            let maxValue = max(1, shown.map { c.count(for: $0) ?? 0 }.max() ?? 1)
            VStack(alignment: .leading, spacing: 8) {
                head(c.hint, trailing: widget.size == .m ? (unread > 0 ? "\(Fmt.num(unread)) ongelezen" : nil) : nil)
                ForEach(shown, id: \.self) { k in
                    let n = c.count(for: k) ?? 0
                    HStack(spacing: 10) {
                        TicketStatusBadge(status: k).frame(width: 130, alignment: .leading)
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Color.white.opacity(0.07))
                                Capsule().fill(Color.bingrRed).frame(width: max(4, geo.size.width * CGFloat(n) / CGFloat(maxValue)))
                            }
                        }
                        .frame(height: 6)
                        Text(Fmt.num(n)).font(.subheadline.weight(.bold)).monospacedDigit().frame(minWidth: 30, alignment: .trailing)
                    }
                }
            }
        } else {
            placeholder(nil)
        }
    }

    // Servicestatus
    @ViewBuilder private var statusView: some View {
        if let d = data.status {
            let level = data.statusLevel
            let openIncidents = d.incidents.filter { $0.endedAt == nil }
            let notices = d.notices.filter { ($0.kind == "incident" && $0.status != "resolved") || $0.status == "in_progress" || $0.status == "scheduled" }
            VStack(alignment: .leading, spacing: 8) {
                head(nil)
                HStack(alignment: .top, spacing: 10) {
                    Circle().fill(DashText.levelColor(level)).frame(width: 12, height: 12).padding(.top, 4)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(DashText.levelText(level)).font(.subheadline.weight(.bold)).lineLimit(1)
                        if level != "operational" && !data.statusAffected.isEmpty {
                            Text(data.statusAffected.joined(separator: ", ")).font(.caption).foregroundStyle(Color.textDim).lineLimit(1)
                        }
                        Text("Laatste controle \(Fmt.ago(d.lastRunAt))").font(.caption).foregroundStyle(Color.textDim).lineLimit(1)
                    }
                }
                if widget.size != .s {
                    let facts = [
                        o.showIncidents == true ? "\(Fmt.num(openIncidents.count)) open \(openIncidents.count == 1 ? "storing" : "storingen")" : nil,
                        o.showNotices == true ? "\(Fmt.num(notices.count)) \(notices.count == 1 ? "melding" : "meldingen")" : nil,
                    ].compactMap { $0 }
                    if !facts.isEmpty {
                        Text(facts.joined(separator: " · ")).font(.caption).foregroundStyle(Color.textSecondary)
                    }
                }
                if widget.size == .l {
                    if o.showNotices == true {
                        ForEach(notices.prefix(4)) { n in
                            listRow(color: n.kind == "maintenance" ? Color(hex: 0x4C8DFF) : Color.monitorState(n.impact == "critical" ? "down" : "degraded"),
                                    title: n.titleNl, detail: Labels.noticeStatus(n.status))
                        }
                    }
                    if o.showIncidents == true {
                        ForEach(openIncidents.prefix(4)) { i in
                            listRow(color: .stateDown, title: i.name, detail: "\(i.cause ?? "onbekende oorzaak") · sinds \(Fmt.ago(i.startedAt))")
                        }
                    }
                }
            }
        } else {
            placeholder(data.statusError)
        }
    }

    // Laatste pushmeldingen (push_history)
    @ViewBuilder private var pushHistoryView: some View {
        if let all = data.pushHistory {
            let items = Array(all.prefix(widget.size == .m ? 2 : (o.count ?? 3)))
            VStack(alignment: .leading, spacing: 8) {
                head("Nieuwste eerst")
                if items.isEmpty {
                    EmptyText(text: "Nog geen pushmeldingen.")
                }
                ForEach(items) { m in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(m.displayTitle).font(.subheadline.weight(.semibold)).lineLimit(1)
                        HStack(spacing: 6) {
                            Chip(text: m.kindLabel, tone: m.kindTone)
                            Text("\(Fmt.date(m.createdAt)) · \(Fmt.num(m.counts.sent)) verstuurd\(m.done ? "" : " · bezig")")
                                .font(.caption).foregroundStyle(Color.textDim).lineLimit(1)
                        }
                    }
                }
            }
        } else {
            placeholder(data.pushHistoryError)
        }
    }

    // Nieuwsbrief: abonnees (bevestigd e-mailadres, uit newsletter_status) / alle leden (stats)
    @ViewBuilder private var newsletterView: some View {
        if let n = data.newsletter {
            let all = data.stats?.totalUsers ?? 0
            let subs = n.recipientsTotal
            let pct = all > 0 ? "\(Int((Double(subs) / Double(all) * 100).rounded()))%" : "—"
            let langs = o.showLangs == false ? nil : "\(Fmt.num(n.recipientsNl)) NL · \(Fmt.num(n.recipientsEn)) EN"
            let state = n.enabled ? (n.nextAt.map { "aan · volgende \(Fmt.longDateTimeNL($0))" } ?? "aan") : "uit"
            if widget.size == .s {
                tile(title, "\(Fmt.num(subs)) / \(Fmt.num(all))",
                     ["\(pct) van de leden", langs, "verzending \(n.enabled ? "aan" : "uit")"].compactMap { $0 }.joined(separator: " · "))
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    head(nil, trailing: Fmt.num(subs))
                    Text("\(Fmt.num(subs)) van \(Fmt.plural(all, "lid", "leden")) (\(pct))")
                        .font(.caption).foregroundStyle(Color.textSecondary).lineLimit(2)
                    Text([langs, "Verzending \(state)"].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(Color.textDim).lineLimit(2)
                }
            }
        } else {
            placeholder(data.newsletterError)
        }
    }

    // Pushabonnees (push_subscribers)
    @ViewBuilder private var pushSubscribersView: some View {
        if let d = data.pushSubscribers {
            let pf = o.pushPlatformList
            let all = pf.count == DashOptions.pushPlatformValues.count
            let devices = all ? d.devices : pf.reduce(0) { $0 + d.count($1) }
            let newText = o.showNew == false ? nil : "+\(Fmt.num(d.newAccounts7d)) \(d.newAccounts7d == 1 ? "account" : "accounts") in 7 dagen"
            if widget.size == .s {
                tile(title, Fmt.num(d.accounts), [Fmt.plural(devices, "apparaat", "apparaten"), newText].compactMap { $0 }.joined(separator: " · "))
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    head(all ? "Bingr-apps met pushmeldingen aan" : "Alleen " + pf.map { PushPlatformOption.name($0) }.joined(separator: ", "),
                         trailing: widget.size == .m ? Fmt.num(d.accounts) : nil)
                    Text("\(Fmt.plural(d.accounts, "account", "accounts")) · \(Fmt.plural(devices, "apparaat", "apparaten"))\(newText.map { " · " + $0 } ?? "")")
                        .font(.caption).foregroundStyle(Color.textSecondary).lineLimit(2)
                    if widget.size == .l {
                        HBarList(rows: pf.map { .init(label: PushPlatformOption.name($0), icon: Labels.platformIcon($0 == "ipados" ? "ipad" : $0), value: d.count($0)) },
                                 limit: 5)
                    } else {
                        Text(pf.map { "\(PushPlatformOption.name($0)) \(Fmt.num(d.count($0)))" }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Color.textDim).lineLimit(2)
                    }
                }
            }
        } else {
            placeholder(data.pushSubscribersError)
        }
    }

    private func planCell(_ name: String, _ value: Int, gold: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(name).font(.caption).foregroundStyle(Color.textSecondary).lineLimit(1)
            Text(Fmt.num(value)).font(.title2.weight(.heavy)).monospacedDigit()
                .foregroundStyle(gold ? Color(hex: 0xFFD54A) : .white)
                .lineLimit(1).minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.04)))
    }

    private func listRow(color: Color, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 4, height: 32)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(detail).font(.caption).foregroundStyle(Color.textDim).lineLimit(1)
            }
        }
    }
}

// MARK: wijzigmodus

/// Balk boven op een widget in de wijzigmodus: grootte, naar voren/achteren, instellen en verbergen.
struct DashEditBar: View {
    let widget: DashWidget
    let title: String
    let isFirst: Bool
    let isLast: Bool
    let setSize: (DashSize) -> Void
    let move: (Int) -> Void
    let settings: () -> Void
    let hide: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Menu {
                ForEach(widget.type.sizes) { z in
                    Button { setSize(z) } label: {
                        if z == widget.size {
                            Label("\(z.name) (\(z.dims))", systemImage: "checkmark")
                        } else {
                            Text("\(z.name) (\(z.dims))")
                        }
                    }
                }
            } label: {
                Text(widget.size.rawValue.uppercased())
                    .font(.caption.weight(.heavy))
                    .foregroundStyle(.black)
                    .frame(width: 30, height: 28)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Color.white))
            }
            .accessibilityLabel("Grootte van \(title): \(widget.size.name.lowercased())")
            Spacer(minLength: 0)
            icon("chevron.left", "\(title) naar voren", disabled: isFirst) { move(-1) }
            icon("chevron.right", "\(title) naar achteren", disabled: isLast) { move(1) }
            icon("slider.horizontal.3", "Gegevens van \(title) instellen") { settings() }
            icon("eye.slash", "\(title) verbergen") { hide() }
        }
        .padding(4)
        .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Color.black.opacity(0.8)))
        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(Color.white.opacity(0.12), lineWidth: 1))
    }

    private func icon(_ name: String, _ label: String, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: name)
                .font(.footnote.weight(.bold))
                .frame(width: 28, height: 28)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color.white.opacity(0.12)))
        }
        .buttonStyle(.plain)
        .foregroundStyle(.white)
        .disabled(disabled)
        .opacity(disabled ? 0.3 : 1)
        .accessibilityLabel(label)
    }
}
