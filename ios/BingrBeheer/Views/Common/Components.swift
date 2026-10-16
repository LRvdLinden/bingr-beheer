import SwiftUI

/// Woordmerk: BINGR met de rode balk eronder (zoals .logo in admin.css).
struct BingrLogo: View {
    var size: CGFloat = 26
    var tag: String? = "Beheer"

    var body: some View {
        HStack(spacing: size * 0.5) {
            Text("BINGR")
                .font(.system(size: size, weight: .black))
                .kerning(size * 0.02)
                .foregroundStyle(.white)
                .padding(.bottom, size * 0.16)
                .overlay(alignment: .bottom) {
                    Capsule().fill(Color.bingrRed)
                        .frame(height: max(2, size * 0.11))
                        .padding(.horizontal, size * 0.12)
                }
            if let tag {
                Text(tag)
                    .font(.system(size: size * 0.58, weight: .semibold))
                    .foregroundStyle(Color.textSecondary)
                    .padding(.leading, size * 0.5)
                    .overlay(alignment: .leading) {
                        Rectangle().fill(Color.white.opacity(0.25)).frame(width: 1)
                    }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("BingrBeheer")
    }
}

/// Tegel met kengetal (zoals .kpi).
struct KPITile: View {
    let label: String
    let value: String
    var hint: String = ""
    var valueColor: Color = .white
    var hintColor: Color = .textDim
    var highlight: Color? = nil
    var small = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.subheadline.weight(.semibold)).foregroundStyle(Color.textSecondary).lineLimit(1)
            Text(value)
                .font(.system(size: small ? 22 : 30, weight: .black))
                .monospacedDigit()
                .foregroundStyle(valueColor)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if !hint.isEmpty {
                Text(hint).font(.caption).foregroundStyle(hintColor).lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, minHeight: small ? 86 : 96, alignment: .topLeading)
        .card(padding: 14, highlight: highlight)
    }
}

/// Kop van een kaart met optionele ondertitel.
struct CardHeader: View {
    let title: String
    var subtitle: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.headline)
            if let subtitle { Text(subtitle).font(.caption).foregroundStyle(Color.textDim) }
        }
    }
}

/// Klein label (zoals .chip).
struct Chip: View {
    let text: String
    var tone: Tone = .neutral
    var icon: String? = nil

    var body: some View {
        HStack(spacing: 3) {
            if let icon { Image(systemName: icon).font(.caption2) }
            Text(text)
        }
        .font(.caption2.weight(.semibold))
        .lineLimit(1)
        .padding(.horizontal, 7)
        .padding(.vertical, 2)
        .foregroundStyle(tone == .neutral ? Color.textSecondary : Color.tone(tone))
        .background(Capsule().fill((tone == .neutral ? Color.white : Color.tone(tone)).opacity(0.12)))
    }
}

/// Status van een ticket (zoals .sbadge).
struct TicketStatusBadge: View {
    let status: String

    var body: some View {
        let c = Color.ticketStatus(status)
        Text(Labels.ticketStatus(status))
            .font(.caption.weight(.bold))
            .lineLimit(1)
            .padding(.horizontal, 9)
            .padding(.vertical, 2)
            .foregroundStyle(c)
            .background(Capsule().fill(c.opacity(0.15)))
            .overlay(Capsule().strokeBorder(c.opacity(0.35), lineWidth: 1))
    }
}

/// Gekleurde stip voor een monitor-toestand.
struct StateDot: View {
    let state: String?
    var size: CGFloat = 10

    var body: some View {
        Circle().fill(Color.monitorState(state)).frame(width: size, height: size)
    }
}

/// Lege toestand of foutmelding in een kaart of lijst.
struct EmptyText: View {
    let text: String

    var body: some View {
        Text(text).font(.subheadline).foregroundStyle(Color.textDim).frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Twee kolommen label/waarde (zoals <dl class="dl">).
struct InfoRow<Value: View>: View {
    let label: String
    @ViewBuilder var value: () -> Value

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label).font(.subheadline).foregroundStyle(Color.textDim).frame(width: 128, alignment: .leading)
            value().font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

extension InfoRow where Value == Text {
    init(_ label: String, _ text: String) {
        self.label = label
        self.value = { Text(text) }
    }
}

/// Knop in Bingr-stijl (rood, of "ghost" grijs).
struct BingrButtonStyle: ButtonStyle {
    var ghost = false
    var danger = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.bold))
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(minHeight: 40)
            .foregroundStyle(danger ? Color(hex: 0xFF8A8F) : .white)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(danger ? Color.bingrRed.opacity(0.12)
                          : ghost ? Color.white.opacity(configuration.isPressed ? 0.22 : 0.15)
                          : (configuration.isPressed ? Color.bingrRedHi : Color.bingrRed))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(danger ? Color.bingrRed.opacity(0.4) : ghost ? Color.white.opacity(0.2) : .clear, lineWidth: 1)
            )
            .opacity(isEnabled ? 1 : 0.5)
    }
}

extension ButtonStyle where Self == BingrButtonStyle {
    static var bingr: BingrButtonStyle { BingrButtonStyle() }
    static var bingrGhost: BingrButtonStyle { BingrButtonStyle(ghost: true) }
    static var bingrDanger: BingrButtonStyle { BingrButtonStyle(danger: true) }
}

/// Melding onderin beeld (zoals #toast).
struct ToastView: View {
    let toast: Toast

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: toast.bad ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .foregroundStyle(toast.bad ? Color.warn : Color.ok)
            Text(toast.text).font(.subheadline).foregroundStyle(.white).multilineTextAlignment(.leading)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.surface3))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .strokeBorder(toast.bad ? Color.bingrRed.opacity(0.6) : Color.white.opacity(0.12), lineWidth: 1))
        .shadow(color: .black.opacity(0.5), radius: 16, y: 6)
        .padding(.horizontal, 16)
    }
}

/// Banner met een waarschuwing (zoals .sup-notice).
struct NoticeBanner: View {
    let text: String
    var tone: Tone = .warn

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Color.tone(tone))
            Text(text).font(.subheadline).foregroundStyle(Color.textSecondary)
        }
        .card(padding: 12, highlight: Color.tone(tone))
    }
}
