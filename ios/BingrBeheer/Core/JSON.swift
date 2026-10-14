import Foundation

/// Losse JSON-waarde. De functie `admin` geeft vrije JSON terug (deels uit andere functies en Postgres);
/// modellen lezen hieruit met standaardwaarden, zodat een ontbrekend of anders getypt veld nooit een scherm breekt.
enum JSON: Decodable, Hashable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSON])
    case object([String: JSON])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            self = .null
        } else if let b = try? c.decode(Bool.self) {
            self = .bool(b)
        } else if let n = try? c.decode(Double.self) {
            self = .number(n)
        } else if let s = try? c.decode(String.self) {
            self = .string(s)
        } else if let a = try? c.decode([JSON].self) {
            self = .array(a)
        } else if let o = try? c.decode([String: JSON].self) {
            self = .object(o)
        } else {
            self = .null
        }
    }

    subscript(key: String) -> JSON {
        if case .object(let o) = self { return o[key] ?? .null }
        return .null
    }

    var isNull: Bool {
        if case .null = self { return true }
        return false
    }

    var object: [String: JSON]? {
        if case .object(let o) = self { return o }
        return nil
    }

    /// Lege lijst als het geen array is.
    var array: [JSON] {
        if case .array(let a) = self { return a }
        return []
    }

    var string: String? {
        switch self {
        case .string(let s): return s
        case .number(let n): return n == n.rounded() && abs(n) < 1e15 ? String(Int64(n)) : String(n)
        case .bool(let b): return b ? "true" : "false"
        default: return nil
        }
    }

    /// Tekst, of nil als die leeg is.
    var text: String? {
        guard let s = string?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        return s
    }

    var double: Double? {
        switch self {
        case .number(let n): return n
        case .string(let s): return Double(s)
        default: return nil
        }
    }

    var int: Int? {
        guard let d = double, d.isFinite else { return nil }
        return Int(d.rounded())
    }

    var bool: Bool? {
        switch self {
        case .bool(let b): return b
        case .number(let n): return n != 0
        case .string(let s): return s == "true" ? true : s == "false" ? false : nil
        default: return nil
        }
    }

    var date: Date? { string.flatMap(DateParser.parse) }

    /// Lijst met teksten (null-waarden en lege teksten weg).
    var strings: [String] { array.compactMap { $0.text } }
}

enum DateParser {
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    /// Ondersteunt ISO 8601 van JavaScript en Postgres: `2026-10-14T08:56:12.123456+00:00`, `…Z`, `2026-10-14 08:56:12+00`
    /// en een losse dag `2026-10-14` (dan 12:00 lokale tijd, zoals het web-dashboard).
    static func parse(_ raw: String) -> Date? {
        var s = raw.trimmingCharacters(in: .whitespaces)
        if s.count == 10 { return day(s) }
        guard s.count > 10 else { return nil }
        let i = s.index(s.startIndex, offsetBy: 10)
        if s[i] == " " { s.replaceSubrange(i...i, with: "T") }
        var fraction = 0.0
        if let r = s.range(of: #"\.\d+"#, options: .regularExpression) {
            fraction = Double("0" + String(s[r])) ?? 0
            s.removeSubrange(r)
        }
        if s.range(of: #"[+-]\d{2}$"#, options: .regularExpression) != nil {
            s += ":00"
        } else if let r = s.range(of: #"[+-]\d{4}$"#, options: .regularExpression) {
            let tz = String(s[r])
            s.replaceSubrange(r, with: String(tz.prefix(3)) + ":" + String(tz.suffix(2)))
        } else if s.range(of: #"(Z|[+-]\d{2}:\d{2})$"#, options: .regularExpression) == nil {
            s += "Z"
        }
        return iso.date(from: s).map { $0.addingTimeInterval(fraction) }
    }

    static func day(_ s: String) -> Date? {
        let p = s.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: 12))
    }
}
