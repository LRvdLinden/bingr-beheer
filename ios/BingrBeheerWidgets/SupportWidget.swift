import SwiftUI
import WidgetKit

/// Widget Support: aantallen nieuw / open (incl. wachtend) / afgerond (opgelost + gesloten). Tik: tab Support.
struct SupportWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: WidgetShared.supportKind, intent: SupportWidgetIntent.self, provider: SupportProvider()) { entry in
            SupportWidgetView(entry: entry)
        }
        .configurationDisplayName("Supporttickets")
        .description("Nieuwe, openstaande en afgeronde supporttickets.")
        .supportedFamilies(WidgetFamilies.smallMediumAccessory)
    }
}

struct SupportProvider: AppIntentTimelineProvider {
    typealias Entry = SummaryEntry<SupportWidgetIntent>
    typealias Intent = SupportWidgetIntent

    func placeholder(in context: Context) -> Entry { .sample(SupportWidgetIntent()) }

    func snapshot(for configuration: SupportWidgetIntent, in context: Context) async -> Entry {
        await SummaryLoader.entry(configuration, preview: context.isPreview)
    }

    func timeline(for configuration: SupportWidgetIntent, in context: Context) async -> Timeline<Entry> {
        await SummaryLoader.timeline(configuration)
    }
}

struct SupportWidgetView: View {
    let entry: SummaryEntry<SupportWidgetIntent>
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .widgetURL(WidgetShared.supportURL)
            .widgetCard(family)
    }

    @ViewBuilder private var content: some View {
        switch entry.load {
        case .signedOut:
            SignedOutView(family: family)
        case .failed:
            FailedView(family: family)
        case .ok(let summary, let stale):
            if let support = summary.support {
                SupportContent(support: support, date: summary.generatedAt, stale: stale,
                               figures: entry.config.figures, main: entry.config.figure,
                               includePending: entry.config.includePending, family: family)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    if family == .systemSmall || family == .systemMedium {
                        WidgetHeader(title: "Support", icon: "lifepreserver", date: summary.generatedAt, stale: stale)
                    }
                    MissingPart(text: "Support niet beschikbaar")
                }
            }
        }
    }
}

/// Inhoud per formaat (ook gebruikt in de gecombineerde widget).
struct SupportContent: View {
    let support: WidgetSummary.Support
    let date: Date
    let stale: Bool
    let figures: [SupportFigure]
    let main: SupportFigure
    let includePending: Bool
    let family: WidgetFamily

    private func value(_ f: SupportFigure) -> Int { f.value(support, includePending: includePending) }

    private var unreadLine: String? {
        support.unread > 0 ? "\(Fmt.num(support.unread)) wacht\(support.unread == 1 ? "" : "en") op reactie" : nil
    }

    var body: some View {
        switch family {
        #if !targetEnvironment(macCatalyst)
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: -1) {
                    Text(Fmt.num(value(main)))
                        .font(.system(size: 20, weight: .bold, design: .rounded).monospacedDigit())
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                        .widgetAccentable()
                        .privacySensitive()
                    Text(main.label.lowercased())
                        .font(.system(size: 9, weight: .semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .padding(4)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Support: \(Fmt.num(value(main))) \(main.label.lowercased())")
        case .accessoryRectangular, .accessoryInline:
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Image(systemName: "lifepreserver")
                    Text("Support")
                    if support.unread > 0 {
                        Image(systemName: "circle.fill").font(.system(size: 6))
                    }
                }
                .font(.headline)
                .widgetAccentable()
                Text(figures.map { "\(Fmt.num(value($0))) \($0.label.lowercased())" }.joined(separator: " · "))
                    .font(.caption)
                    .lineLimit(2)
                    .privacySensitive()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        #endif
        case .systemSmall:
            VStack(alignment: .leading, spacing: 6) {
                WidgetHeader(title: "Support", icon: "lifepreserver", date: date, stale: stale)
                Spacer(minLength: 0)
                ForEach(figures, id: \.self) { f in
                    HStack(alignment: .firstTextBaseline) {
                        HStack(spacing: 4) {
                            Circle().fill(Color.ticketStatus(f.colorKey)).frame(width: 6, height: 6)
                            Text(f.label)
                                .font(.caption)
                                .foregroundStyle(Color.textSecondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 4)
                        Text(Fmt.num(value(f)))
                            .font(.system(size: figures.count > 2 ? 18 : 22, weight: .bold, design: .rounded).monospacedDigit())
                            .foregroundStyle(.white)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                            .privacySensitive()
                    }
                    .accessibilityElement(children: .combine)
                }
                if let unreadLine {
                    Text(unreadLine)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.bingrRedHi)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        default:
            VStack(alignment: .leading, spacing: 8) {
                WidgetHeader(title: "Supporttickets", icon: "lifepreserver", date: date, stale: stale)
                Spacer(minLength: 0)
                HStack(alignment: .bottom, spacing: 10) {
                    ForEach(figures, id: \.self) { f in
                        CountTile(label: tileLabel(f), value: value(f), color: Color.ticketStatus(f.colorKey))
                    }
                }
                Spacer(minLength: 0)
                HStack(spacing: 6) {
                    if let unreadLine {
                        Text(unreadLine)
                            .foregroundStyle(Color.bingrRedHi)
                            .fontWeight(.semibold)
                    }
                    Spacer(minLength: 0)
                    Text("\(Fmt.num(support.last7d)) nieuw in 7 dagen")
                        .foregroundStyle(Color.textDim)
                }
                .font(.caption2)
                .lineLimit(1)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private func tileLabel(_ f: SupportFigure) -> String {
        f == .open && includePending && support.pending > 0 ? "Open (\(Fmt.num(support.pending)) wacht)" : f.label
    }
}
