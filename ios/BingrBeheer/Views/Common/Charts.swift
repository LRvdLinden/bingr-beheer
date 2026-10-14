import Charts
import SwiftUI

/// Staafdiagram per dag (laatste 30 dagen) met selectie, zoals barChart() in admin.js.
struct DailyBarChart: View {
    struct Point: Identifiable {
        var id: Date { day }
        let day: Date
        let value: Int
    }

    let points: [Point]
    /// eenheid in de tooltip, bv. "nieuwe gebruikers"
    let unit: String

    @State private var selected: Date?

    private var selectedPoint: Point? {
        guard let selected else { return nil }
        let cal = Calendar.current
        return points.first { cal.isDate($0.day, inSameDayAs: selected) }
    }

    var body: some View {
        if points.isEmpty {
            EmptyText(text: "Nog geen gegevens.").frame(height: 60)
        } else {
            Chart {
                ForEach(points) { p in
                    BarMark(x: .value("Dag", p.day, unit: .day), y: .value(unit, p.value))
                        .foregroundStyle(p.value == 0 ? Color.white.opacity(0.12)
                                         : (selectedPoint?.day == p.day ? Color.bingrRedHi : Color.bingrRed))
                        .cornerRadius(3)
                }
                if let s = selectedPoint {
                    RuleMark(x: .value("Dag", s.day, unit: .day))
                        .foregroundStyle(Color.white.opacity(0.15))
                        .annotation(position: .top, spacing: 4, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(Fmt.num(s.value)) \(unit)").font(.caption.weight(.bold))
                                Text(Fmt.longDay(s.day)).font(.caption2).foregroundStyle(Color.textDim)
                            }
                            .padding(8)
                            .background(RoundedRectangle(cornerRadius: 8).fill(Color.surface3))
                        }
                }
            }
            .chartXSelection(value: $selected)
            .chartXAxis {
                AxisMarks(values: .stride(by: .day, count: 7)) { value in
                    AxisGridLine().foregroundStyle(Color.clear)
                    AxisValueLabel {
                        if let d = value.as(Date.self) { Text(Fmt.shortDay(d)) }
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { _ in
                    AxisGridLine().foregroundStyle(Color.white.opacity(0.08))
                    AxisValueLabel()
                }
            }
            .frame(height: 190)
        }
    }
}

/// Horizontale staven met label en aantal (zoals hbars() in admin.js): max. 14 rijen.
struct HBarList: View {
    struct Row: Identifiable {
        let id = UUID()
        let label: String
        var detail: String? = nil
        var icon: String? = nil
        let value: Int
    }

    let rows: [Row]
    var limit = 14

    var body: some View {
        if rows.isEmpty {
            EmptyText(text: "Nog geen gegevens.")
        } else {
            let maxValue = max(rows.map(\.value).max() ?? 1, 1)
            VStack(alignment: .leading, spacing: 10) {
                ForEach(rows.prefix(limit)) { r in
                    HStack(spacing: 10) {
                        HStack(spacing: 6) {
                            if let icon = r.icon {
                                Image(systemName: icon).font(.caption).foregroundStyle(Color.textSecondary).frame(width: 18)
                            }
                            Text(r.label).font(.subheadline).lineLimit(1)
                            if let d = r.detail { Text(d).font(.caption2).foregroundStyle(Color.textDim).lineLimit(1) }
                        }
                        .frame(width: 150, alignment: .leading)
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Color.white.opacity(0.07))
                                Capsule().fill(Color.bingrRed)
                                    .frame(width: max(4, geo.size.width * CGFloat(r.value) / CGFloat(maxValue)))
                            }
                        }
                        .frame(height: 8)
                        Text(Fmt.num(r.value)).font(.subheadline.weight(.semibold)).monospacedDigit()
                            .frame(minWidth: 36, alignment: .trailing)
                    }
                }
                if rows.count > limit {
                    Text("+ \(rows.count - limit) meer").font(.caption).foregroundStyle(Color.textDim)
                }
            }
        }
    }
}

/// Reactietijd van de laatste 24 uur; punten die niet "up" zijn gekleurd (zoals lineChart() in admin.js).
struct ResponseTimeChart: View {
    let checks: [MonitorCheck]

    private struct P: Identifiable {
        let id = UUID()
        let at: Date
        let ms: Double
        let state: String
    }

    var body: some View {
        let pts = checks.compactMap { c -> P? in
            guard let at = c.at, let ms = c.ms else { return nil }
            return P(at: at, ms: ms, state: c.state)
        }.sorted { $0.at < $1.at }
        if pts.count < 2 {
            EmptyText(text: "Nog te weinig controles voor een grafiek.")
        } else {
            Chart {
                ForEach(pts) { p in
                    LineMark(x: .value("Tijd", p.at), y: .value("ms", p.ms))
                        .foregroundStyle(Color.bingrRed)
                        .interpolationMethod(.monotone)
                }
                ForEach(pts.filter { $0.state != "up" }) { p in
                    PointMark(x: .value("Tijd", p.at), y: .value("ms", p.ms))
                        .foregroundStyle(Color.monitorState(p.state))
                        .symbolSize(30)
                }
            }
            .chartXScale(domain: Date().addingTimeInterval(-24 * 3600)...Date())
            .chartXAxis {
                AxisMarks(values: .stride(by: .hour, count: 6)) { value in
                    AxisGridLine().foregroundStyle(Color.white.opacity(0.05))
                    AxisValueLabel {
                        if let d = value.as(Date.self) { Text(Fmt.time(d)) }
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { _ in
                    AxisGridLine().foregroundStyle(Color.white.opacity(0.08))
                    AxisValueLabel()
                }
            }
            .frame(height: 180)
        }
    }
}
