import SwiftUI
import WidgetKit

// Bouwstenen van de widgets in de stijl van de app (kleuren uit Theme.swift).

extension View {
    /// Achtergrond van de widget (iOS 17: containerBackground). Op het beginscherm de donkere kaart van de app,
    /// op het toegangsscherm niets (het systeem kleurt de achtergrond zelf).
    @ViewBuilder
    func widgetCard(_ family: WidgetFamily) -> some View {
        switch family {
        case .accessoryCircular, .accessoryRectangular, .accessoryInline:
            containerBackground(for: .widget) { Color.clear }
        default:
            containerBackground(for: .widget) {
                LinearGradient(colors: [Color(hex: 0x1D1D24), Color(hex: 0x151515), Color(hex: 0x170D0E)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
            }
        }
    }
}

/// Kop van een widget: icoon en titel, rechts het tijdstip van de stand.
struct WidgetHeader: View {
    let title: String
    let icon: String
    var date: Date?
    var stale = false

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: icon)
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.bingrRed)
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.textSecondary)
                .lineLimit(1)
            Spacer(minLength: 4)
            if stale {
                Image(systemName: "wifi.slash")
                    .font(.caption2)
                    .foregroundStyle(Color.textDim)
                    .accessibilityLabel("Geen verbinding, laatst bekende stand")
            }
            if let date {
                Text(date, format: .dateTime.hour().minute())
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(Color.textDim)
            }
        }
    }
}

/// Getal met label (tegel in de supportwidget).
struct CountTile: View {
    let label: String
    let value: Int
    let color: Color
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(Fmt.num(value))
                .font(.system(size: compact ? 22 : 28, weight: .bold, design: .rounded).monospacedDigit())
                .foregroundStyle(.white)
                .minimumScaleFactor(0.5)
                .lineLimit(1)
                .privacySensitive()
            HStack(spacing: 4) {
                Circle().fill(color).frame(width: 6, height: 6)
                Text(label)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(Color.textSecondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// Eén onderdeel met gekleurde stip en korte status.
struct ComponentRow: View {
    let component: WidgetSummary.Component

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(StatusLevel.color(component.level)).frame(width: 7, height: 7)
            Text(component.name)
                .font(.caption)
                .foregroundStyle(.white)
                .lineLimit(1)
            Spacer(minLength: 4)
            Text(StatusLevel.short(component.level))
                .font(.caption2)
                .foregroundStyle(component.level == "operational" ? Color.textDim : StatusLevel.color(component.level))
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Niet ingelogd: open de app om in te loggen (ook na "overal uitloggen" of een verlopen widget-token).
struct SignedOutView: View {
    let family: WidgetFamily

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "person.crop.circle.badge.exclamationmark")
                    .font(.title3)
            }
            .accessibilityLabel("Open Bingr Beheer om in te loggen")
        case .accessoryRectangular, .accessoryInline:
            VStack(alignment: .leading, spacing: 1) {
                Text("Bingr Beheer").font(.headline).widgetAccentable()
                Text("Open de app om in te loggen").font(.caption).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default:
            VStack(alignment: .leading, spacing: 8) {
                WidgetLogo()
                Spacer(minLength: 0)
                Image(systemName: "lock.fill")
                    .font(.title3)
                    .foregroundStyle(Color.bingrRed)
                Text("Open Bingr Beheer om in te loggen")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

/// Geen verbinding en nog geen eerdere stand.
struct FailedView: View {
    let family: WidgetFamily

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "wifi.slash").font(.title3)
            }
            .accessibilityLabel("Geen verbinding")
        case .accessoryRectangular, .accessoryInline:
            VStack(alignment: .leading, spacing: 1) {
                Text("Bingr Beheer").font(.headline).widgetAccentable()
                Text("Geen verbinding").font(.caption)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default:
            VStack(alignment: .leading, spacing: 8) {
                WidgetLogo()
                Spacer(minLength: 0)
                Image(systemName: "wifi.slash").font(.title3).foregroundStyle(Color.textDim)
                Text("Geen verbinding met de server")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

/// Klein woordmerk: BINGR met de rode balk (zoals BingrLogo in de app).
struct WidgetLogo: View {
    var body: some View {
        Text("BINGR")
            .font(.system(size: 13, weight: .black))
            .kerning(0.3)
            .foregroundStyle(.white)
            .padding(.bottom, 2)
            .overlay(alignment: .bottom) {
                Capsule().fill(Color.bingrRed).frame(height: 2).padding(.horizontal, 1.5)
            }
            .accessibilityLabel("Bingr Beheer")
    }
}

/// Melding als een deel van de gegevens ontbreekt (bv. de functie status of support is niet bereikbaar).
struct MissingPart: View {
    let text: String

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "exclamationmark.circle").font(.caption2)
            Text(text).font(.caption2).lineLimit(2)
        }
        .foregroundStyle(Color.textDim)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
