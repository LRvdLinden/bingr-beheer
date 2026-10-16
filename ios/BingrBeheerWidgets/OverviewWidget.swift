import SwiftUI
import WidgetKit

/// Gecombineerde widget: servicestatus en supporttickets naast elkaar (middel) of onder elkaar (groot).
/// Tik op een helft: die tab in de app (Link werkt in middel en groot).
struct OverviewWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetShared.overviewKind, provider: OverviewProvider()) { entry in
            OverviewWidgetView(entry: entry)
        }
        .configurationDisplayName("BingrBeheer")
        .description("Servicestatus en supporttickets in één widget.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct OverviewProvider: TimelineProvider {
    typealias Entry = SummaryEntry<NoWidgetConfig>

    func placeholder(in context: Context) -> Entry { .sample(NoWidgetConfig()) }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        let preview = context.isPreview
        Task { completion(await SummaryLoader.entry(NoWidgetConfig(), preview: preview)) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        Task { completion(await SummaryLoader.timeline(NoWidgetConfig())) }
    }
}

struct OverviewWidgetView: View {
    let entry: SummaryEntry<NoWidgetConfig>
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .widgetURL(WidgetShared.overviewURL)
            .widgetCard(family)
    }

    @ViewBuilder private var content: some View {
        switch entry.load {
        case .signedOut:
            SignedOutView(family: family)
        case .failed:
            FailedView(family: family)
        case .ok(let summary, let stale):
            if family == .systemLarge {
                VStack(alignment: .leading, spacing: 12) {
                    statusPart(summary, stale: stale, inner: .systemMedium)
                    Divider().overlay(Color.line)
                    supportPart(summary, stale: stale, inner: .systemMedium)
                }
            } else {
                HStack(alignment: .top, spacing: 14) {
                    statusPart(summary, stale: stale, inner: .systemSmall)
                    Divider().overlay(Color.line)
                    supportPart(summary, stale: stale, inner: .systemSmall)
                }
            }
        }
    }

    @ViewBuilder
    private func statusPart(_ s: WidgetSummary, stale: Bool, inner: WidgetFamily) -> some View {
        Link(destination: WidgetShared.statusURL) {
            if let status = s.status {
                StatusContent(status: status, date: s.generatedAt, stale: stale, onlyProblems: false, family: inner)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    WidgetHeader(title: "Status", icon: "waveform.path.ecg", date: s.generatedAt, stale: stale)
                    MissingPart(text: "Status niet beschikbaar")
                }
            }
        }
    }

    @ViewBuilder
    private func supportPart(_ s: WidgetSummary, stale: Bool, inner: WidgetFamily) -> some View {
        Link(destination: WidgetShared.supportURL) {
            if let support = s.support {
                SupportContent(support: support, date: s.generatedAt, stale: stale, figures: [.new, .open, .done], main: .open,
                               includePending: true, family: inner)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    WidgetHeader(title: "Support", icon: "lifepreserver", date: s.generatedAt, stale: stale)
                    MissingPart(text: "Support niet beschikbaar")
                }
            }
        }
    }
}
