import SwiftUI

/// Notities van een build (Bingr-changelog, of voor de Beheer-app de interne changelog ios/changelog.json) netjes
/// opgemaakt, zoals op het web: "### kop", "**Nieuw**" op een eigen regel = kopje, "- punt" = opsomming,
/// "_datum_" = grijs, verder alinea's. Binnen een regel alleen **vet** en `code` (geen links, geen HTML).
struct BuildNotesView: View {
    let text: String

    enum Block: Hashable {
        case heading(String)
        case kind(String)
        case bullet(String)
        case dim(String)
        case paragraph(String)
    }

    static func parse(_ text: String) -> [Block] {
        var out: [Block] = []
        for raw in text.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            if let r = line.range(of: #"^[-*•]\s+"#, options: .regularExpression) {
                out.append(.bullet(String(line[r.upperBound...])))
            } else if let r = line.range(of: #"^#{1,6}\s+"#, options: .regularExpression) {
                out.append(.heading(String(line[r.upperBound...])))
            } else if line.range(of: #"^\*\*[^*]+\*\*:?$"#, options: .regularExpression) != nil {
                out.append(.kind(line.trimmingCharacters(in: CharacterSet(charactersIn: "*:")).trimmingCharacters(in: .whitespaces)))
            } else if line.count > 2, line.hasPrefix("_"), line.hasSuffix("_") {
                out.append(.dim(String(line.dropFirst().dropLast())))
            } else {
                out.append(.paragraph(line))
            }
        }
        return out
    }

    /// **vet** en `code` binnen een regel; de rest letterlijk.
    static func inline(_ s: String) -> AttributedString {
        var result = AttributedString()
        var rest = Substring(s)
        while !rest.isEmpty {
            let bold = rest.range(of: "**")
            let code = rest.range(of: "`")
            guard let start = [bold, code].compactMap({ $0 }).min(by: { $0.lowerBound < $1.lowerBound }) else {
                result += AttributedString(String(rest)); break
            }
            let marker = String(rest[start])
            let after = rest[start.upperBound...]
            guard let end = after.range(of: marker), !after[..<end.lowerBound].isEmpty else {
                result += AttributedString(String(rest[..<start.upperBound])); rest = after; continue
            }
            result += AttributedString(String(rest[..<start.lowerBound]))
            var part = AttributedString(String(after[..<end.lowerBound]))
            if marker == "**" { part.inlinePresentationIntent = .stronglyEmphasized } else { part.inlinePresentationIntent = .code }
            result += part
            rest = after[end.upperBound...]
        }
        return result
    }

    private static func kindColor(_ k: String) -> Color {
        switch k {
        case "Nieuw": return .ok
        case "Verbeterd": return .stateInfo
        case "Opgelost": return .stateDegraded
        default: return .textSecondary
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(Self.parse(text).enumerated()), id: \.offset) { _, block in
                switch block {
                case .heading(let s):
                    Text(Self.inline(s)).font(.subheadline.weight(.bold)).foregroundStyle(.white).padding(.top, 8)
                case .kind(let s):
                    Text(verbatim: s.uppercased()).font(.caption.weight(.bold)).tracking(0.5)
                        .foregroundStyle(Self.kindColor(s)).padding(.top, 6)
                case .bullet(let s):
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(verbatim: "•").foregroundStyle(Color.textSecondary)
                        Text(Self.inline(s)).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .font(.subheadline)
                    .foregroundStyle(Color(hex: 0xE6E6E6))
                case .dim(let s):
                    Text(verbatim: s).font(.caption).foregroundStyle(Color.textDim)
                case .paragraph(let s):
                    Text(Self.inline(s)).font(.subheadline).foregroundStyle(Color(hex: 0xE6E6E6))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }
}
