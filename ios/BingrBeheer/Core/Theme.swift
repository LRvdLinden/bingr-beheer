import SwiftUI

/// Kleuren van bingr.online / het web-dashboard (web/admin.css).
extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: alpha)
    }

    static let bingrRed = Color(hex: 0xE50914)
    static let bingrRedHi = Color(hex: 0xFF2A35)
    static let surface1 = Color(hex: 0x121212)
    static let surface2 = Color(hex: 0x1C1C1C)
    static let surface3 = Color(hex: 0x262626)
    static let line = Color.white.opacity(0.12)
    static let textSecondary = Color(hex: 0xBDBDBD)
    static let textDim = Color(hex: 0x8F8F8F)
    static let ok = Color(hex: 0x46D369)
    static let warn = Color(hex: 0xFF8A5C)
    static let bad = Color(hex: 0xFF6B6B)
    static let stateUp = Color(hex: 0x3FCF6A)
    static let stateDegraded = Color(hex: 0xF5A524)
    static let stateDown = Color(hex: 0xFF3B46)
    static let stateNone = Color(hex: 0x2B2B2B)
    static let stateInfo = Color(hex: 0x5AA9FF)

    static func monitorState(_ s: String?) -> Color {
        switch s {
        case "up": return .stateUp
        case "degraded": return .stateDegraded
        case "down": return .stateDown
        case "off": return Color(hex: 0x555555)
        case "info": return .stateInfo
        default: return .stateNone
        }
    }

    static func tone(_ t: Tone) -> Color {
        switch t {
        case .good: return .ok
        case .bad: return .bad
        case .warn: return .stateDegraded
        case .neutral: return .textSecondary
        }
    }

    /// Kleur van een ticketstatus (zelfde als .sbadge in admin.css).
    static func ticketStatus(_ s: String) -> Color {
        switch s {
        case "new": return Color(hex: 0xFF8A8F)
        case "open": return Color(hex: 0x8CB8FF)
        case "pending": return Color(hex: 0xFFC56B)
        case "resolved": return .ok
        default: return .textSecondary
        }
    }
}

/// Achtergrond van de kaarten (zoals .kpi en .panel).
struct CardBackground: View {
    var highlight: Color? = nil

    var body: some View {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
            .fill(LinearGradient(colors: highlight != nil
                                 ? [Color(hex: 0x2A1013), Color(hex: 0x151515), Color(hex: 0x170D0E)]
                                 : [Color(hex: 0x1D1D24), Color(hex: 0x151515), Color(hex: 0x170D0E)],
                                 startPoint: .topLeading, endPoint: .bottomTrailing))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(highlight?.opacity(0.4) ?? Color.white.opacity(0.08), lineWidth: 1))
    }
}

extension View {
    /// Kaart in Bingr-stijl.
    func card(padding: CGFloat = 16, highlight: Color? = nil) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(CardBackground(highlight: highlight))
    }

    /// Zwarte achtergrond voor een scherm.
    func screenBackground() -> some View {
        self.background(Color.black.ignoresSafeArea())
    }
}
