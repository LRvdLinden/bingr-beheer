import AppIntents
import WidgetKit

/// Instellingen van de widget Servicestatus (lang indrukken → Wijzig widget).
struct StatusWidgetIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Servicestatus"
    static var description = IntentDescription("Algemene status van Bingr en de status per onderdeel.")

    @Parameter(title: "Alleen problemen tonen", default: false)
    var onlyProblems: Bool

    init() {}
}

/// Hoofdgetal van de supportwidget (kleine widget en rond op het toegangsscherm).
enum SupportFigure: String, AppEnum, CaseIterable {
    case new, open, done

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Teller"
    static var caseDisplayRepresentations: [SupportFigure: DisplayRepresentation] = [
        .new: "Nieuw",
        .open: "Open",
        .done: "Afgerond",
    ]
}

/// Instellingen van de widget Support: welke ticketstatussen tonen.
struct SupportWidgetIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Supporttickets"
    static var description = IntentDescription("Aantal nieuwe, openstaande en afgeronde supporttickets.")

    @Parameter(title: "Nieuw", default: true)
    var showNew: Bool

    @Parameter(title: "Open", default: true)
    var showOpen: Bool

    @Parameter(title: "Wacht op klant meetellen bij open", default: true)
    var includePending: Bool

    @Parameter(title: "Afgerond (opgelost en gesloten)", default: true)
    var showDone: Bool

    @Parameter(title: "Hoofdteller (rond op toegangsscherm)", default: .open)
    var figure: SupportFigure

    init() {}

    /// Gekozen tellers in vaste volgorde; niets gekozen = alle drie.
    var figures: [SupportFigure] {
        let f = [showNew ? SupportFigure.new : nil, showOpen ? .open : nil, showDone ? .done : nil].compactMap { $0 }
        return f.isEmpty ? [.new, .open, .done] : f
    }
}

extension SupportFigure {
    var label: String {
        switch self {
        case .new: return "Nieuw"
        case .open: return "Open"
        case .done: return "Afgerond"
        }
    }

    func value(_ s: WidgetSummary.Support, includePending: Bool) -> Int {
        switch self {
        case .new: return s.new
        case .open: return s.openCount(includePending: includePending)
        case .done: return s.done
        }
    }

    /// Zelfde kleuren als de statusbadges in de app (Color.ticketStatus).
    var colorKey: String {
        switch self {
        case .new: return "new"
        case .open: return "open"
        case .done: return "resolved"
        }
    }
}
