import SwiftUI

/// Covermuur achter het inlog- en vergrendelscherm, zoals .login-wall in web/admin.css:
/// schuin (−11°), willekeurige volgorde, donker met verloop + vignet, langzaam drijvend (90 s heen en terug),
/// met een rode gloed in het midden. Zonder beweging bij "Verminder beweging".
struct CoverWall: View {
    static let count = 36

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var order: [Int] = Array(1...CoverWall.count).shuffled()
    @State private var drift = false
    @State private var shown = false

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            ZStack {
                Color.black
                wall(in: size)
                    .opacity(shown ? 0.9 : 0)
                // donkere laag + vignet zodat de kaart leesbaar blijft
                EllipticalGradient(stops: [
                    .init(color: .black.opacity(0.88), location: 0),
                    .init(color: .black.opacity(0.72), location: 0.4),
                    .init(color: .black.opacity(0.45), location: 0.75),
                    .init(color: .black.opacity(0.6), location: 1),
                ], center: .center, startRadiusFraction: 0, endRadiusFraction: 0.6)
                LinearGradient(stops: [
                    .init(color: .black.opacity(0.85), location: 0),
                    .init(color: .black.opacity(0.25), location: 0.25),
                    .init(color: .black.opacity(0.25), location: 0.72),
                    .init(color: .black.opacity(0.9), location: 1),
                ], startPoint: .top, endPoint: .bottom)
                // rode gloed achter de kaart
                EllipticalGradient(colors: [Color.bingrRed.opacity(0.22), .clear],
                                   center: .center, startRadiusFraction: 0, endRadiusFraction: 0.5)
                    .frame(width: min(900, size.width * 1.6), height: min(520, size.height * 0.75))
            }
            .frame(width: size.width, height: size.height)
            .clipped()
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear {
            withAnimation(.easeOut(duration: 0.9)) { shown = true }
            startDrift()
        }
        .onChange(of: reduceMotion) { _, _ in startDrift() }
    }

    private func startDrift() {
        if reduceMotion {
            var t = Transaction(); t.disablesAnimations = true
            withTransaction(t) { drift = false }
        } else if !drift {
            withAnimation(.linear(duration: 90).repeatForever(autoreverses: true)) { drift = true }
        }
    }

    /// De muur: kolommen posters, groter dan het scherm zodat de hoeken na het draaien gevuld blijven.
    private func wall(in size: CGSize) -> some View {
        let short = min(size.width, size.height)
        let posterW = min(150, max(78, short / 4))
        let posterH = posterW * 1.5
        let gap: CGFloat = posterW > 110 ? 14 : 10
        // diagonaal + marge voor draaiing en drift
        let diag = (size.width * size.width + size.height * size.height).squareRoot()
        let wallW = diag * 1.2
        let wallH = diag * 1.2
        let cols = Int((wallW / (posterW + gap)).rounded(.up))
        let rows = Int((wallH / (posterH + gap)).rounded(.up)) + 1
        let radius: CGFloat = posterW > 110 ? 10 : 8

        return HStack(alignment: .top, spacing: gap) {
            ForEach(0..<cols, id: \.self) { c in
                VStack(spacing: gap) {
                    ForEach(0..<rows, id: \.self) { r in
                        Image(name(c, r))
                            .resizable()
                            .aspectRatio(2.0 / 3.0, contentMode: .fill)
                            .frame(width: posterW, height: posterH)
                            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.07), lineWidth: 1))
                    }
                }
                .offset(y: c.isMultiple(of: 2) ? 0 : -posterH * 0.4)
            }
        }
        .frame(width: wallW, height: wallH, alignment: .center)
        .offset(x: drift ? -wallW * 0.04 : 0, y: drift ? -wallH * 0.03 : 0)
        .rotation3DEffect(.degrees(8), axis: (x: 1, y: 0, z: 0), perspective: 0.4)
        .rotationEffect(.degrees(-11))
        .frame(width: size.width, height: size.height)
    }

    private func name(_ c: Int, _ r: Int) -> String {
        let id = order[(c * 7 + r * 5) % order.count]
        return String(format: "cover%02d", id)
    }
}

/// Inlogkaart over de covermuur: licht doorschijnend met blur (zoals .login-card).
struct GlassCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(LinearGradient(colors: [Color(hex: 0x1D1D24, alpha: 0.72),
                                                      Color(hex: 0x151515, alpha: 0.72),
                                                      Color(hex: 0x1B0A0C, alpha: 0.72)],
                                             startPoint: .topLeading, endPoint: .bottomTrailing)))
            }
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color.white.opacity(0.1)))
            .shadow(color: .black.opacity(0.75), radius: 40, y: 20)
    }
}

extension View {
    func glassCard() -> some View { modifier(GlassCard()) }
}
