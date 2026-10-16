import SwiftUI
import WidgetKit

/// Widget Servicestatus: algemene status en per onderdeel (uit `widget_summary`, zoals de tab Status). Tik: tab Status.
struct StatusWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: WidgetShared.statusKind, intent: StatusWidgetIntent.self, provider: StatusProvider()) { entry in
            StatusWidgetView(entry: entry)
        }
        .configurationDisplayName("Servicestatus")
        .description("Algemene status van Bingr en de status per onderdeel.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular])
    }
}

struct StatusProvider: AppIntentTimelineProvider {
    typealias Entry = SummaryEntry<StatusWidgetIntent>
    typealias Intent = StatusWidgetIntent

    func placeholder(in context: Context) -> Entry { .sample(StatusWidgetIntent()) }

    func snapshot(for configuration: StatusWidgetIntent, in context: Context) async -> Entry {
        await SummaryLoader.entry(configuration, preview: context.isPreview)
    }

    func timeline(for configuration: StatusWidgetIntent, in context: Context) async -> Timeline<Entry> {
        await SummaryLoader.timeline(configuration)
    }
}

struct StatusWidgetView: View {
    let entry: SummaryEntry<StatusWidgetIntent>
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .widgetURL(WidgetShared.statusURL)
            .widgetCard(family)
    }

    @ViewBuilder private var content: some View {
        switch entry.load {
        case .signedOut:
            SignedOutView(family: family)
        case .failed:
            FailedView(family: family)
        case .ok(let summary, let stale):
            if let status = summary.status {
                StatusContent(status: status, date: summary.generatedAt, stale: stale, onlyProblems: entry.config.onlyProblems, family: family)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    if family == .systemSmall || family == .systemMedium {
                        WidgetHeader(title: "Status", icon: "waveform.path.ecg", date: summary.generatedAt, stale: stale)
                    }
                    MissingPart(text: "Status niet beschikbaar")
                }
            }
        }
    }
}

/// Inhoud per formaat (ook gebruikt in de gecombineerde widget).
struct StatusContent: View {
    let status: WidgetSummary.Status
    let date: Date
    let stale: Bool
    let onlyProblems: Bool
    let family: WidgetFamily

    private var color: Color { StatusLevel.color(status.level) }

    /// Onderdelen om te tonen: problemen eerst (zo levert de server ze al), desgewenst alleen problemen.
    private var rows: [WidgetSummary.Component] {
        onlyProblems ? status.problems : status.components
    }

    private var summaryLine: String {
        let p = status.problemCount
        if status.total == 0 { return "Geen onderdelen" }
        if p == 0 { return "\(Fmt.plural(status.total, "onderdeel werkt", "onderdelen werken"))" }
        return "\(Fmt.num(p)) van \(Fmt.num(status.total)) met een probleem"
    }

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: StatusLevel.icon(status.level))
                        .font(.title3.weight(.semibold))
                        .widgetAccentable()
                    if status.problemCount > 0 {
                        Text(Fmt.num(status.problemCount))
                            .font(.caption2.weight(.bold).monospacedDigit())
                    }
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Status: \(StatusLevel.title(status.level))")
        case .accessoryRectangular, .accessoryInline:
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Image(systemName: StatusLevel.icon(status.level))
                    Text(StatusLevel.title(status.level)).lineLimit(1)
                }
                .font(.headline)
                .widgetAccentable()
                if status.problems.isEmpty {
                    Text(summaryLine).font(.caption).lineLimit(1)
                } else {
                    Text(status.problems.prefix(3).map(\.name).joined(separator: ", "))
                        .font(.caption)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .systemSmall:
            VStack(alignment: .leading, spacing: 6) {
                WidgetHeader(title: "Status", icon: "waveform.path.ecg", date: date, stale: stale)
                Spacer(minLength: 0)
                Image(systemName: StatusLevel.icon(status.level))
                    .font(.title2)
                    .foregroundStyle(color)
                Text(StatusLevel.title(status.level))
                    .font(.headline)
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                if let first = status.problems.first {
                    Text(status.problems.count > 1 ? "\(first.name) +\(status.problems.count - 1)" : first.name)
                        .font(.caption)
                        .foregroundStyle(StatusLevel.color(first.level))
                        .lineLimit(1)
                } else {
                    Text(summaryLine)
                        .font(.caption)
                        .foregroundStyle(Color.textSecondary)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        default:
            VStack(alignment: .leading, spacing: 8) {
                WidgetHeader(title: "Servicestatus", icon: "waveform.path.ecg", date: date, stale: stale)
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Image(systemName: StatusLevel.icon(status.level))
                            .font(.title2)
                            .foregroundStyle(color)
                        Text(StatusLevel.title(status.level))
                            .font(.headline)
                            .foregroundStyle(.white)
                            .lineLimit(2)
                            .minimumScaleFactor(0.8)
                        Text(summaryLine)
                            .font(.caption2)
                            .foregroundStyle(Color.textSecondary)
                            .lineLimit(2)
                        if status.activeNotices > 0 {
                            Text(Fmt.plural(status.activeNotices, "melding", "meldingen"))
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(Color.stateDegraded)
                        }
                    }
                    .frame(width: 112, alignment: .leading)
                    VStack(alignment: .leading, spacing: 4) {
                        if rows.isEmpty {
                            Text(onlyProblems ? "Alle onderdelen werken" : "Geen onderdelen")
                                .font(.caption)
                                .foregroundStyle(Color.textSecondary)
                        } else {
                            ForEach(rows.prefix(5)) { ComponentRow(component: $0) }
                            if rows.count > 5 {
                                Text("+\(rows.count - 5) meer")
                                    .font(.caption2)
                                    .foregroundStyle(Color.textDim)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}
