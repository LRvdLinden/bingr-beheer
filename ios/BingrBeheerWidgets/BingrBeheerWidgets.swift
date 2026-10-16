import SwiftUI
import WidgetKit

/// Widget-extensie van BingrBeheer (bundle-id nl.lrvdlinden.bingr.beheer.widgets, iOS/iPadOS 17+).
/// Leest het widget-token uit de gedeelde Keychain-groep (WidgetTokenStore) en haalt `widget_summary` op bij de functie admin.
@main
struct BingrBeheerWidgets: WidgetBundle {
    var body: some Widget {
        StatusWidget()
        SupportWidget()
        OverviewWidget()
    }
}
