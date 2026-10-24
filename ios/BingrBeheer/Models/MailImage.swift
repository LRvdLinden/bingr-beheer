import UIKit

/// Afbeelding bovenaan een eigen mailing (zoals web/admin.js): klaarmaken voor het uploaden naar de bucket mail-assets
/// (actie mailing_image_upload van de functie admin). PNG, JPG of GIF, max. 2 MB; breder dan 1000 px (2× de mailbreedte
/// van 500 px) wordt verkleind. Een foto in een ander formaat (bijv. HEIC uit de fotobibliotheek) wordt een JPG; een GIF
/// blijft zoals hij is (anders is de animatie weg). SVG en WebP worden geweigerd, net als op de server.
enum MailImage {
    static let maxBytes = 2 * 1024 * 1024
    static let maxWidth: CGFloat = 1000

    enum Kind: String { case png, jpeg, gif, webp, svg, other }

    struct Prepared {
        let data: Data
        let kind: Kind
        let pixels: CGSize
        let resizedFrom: Int?
    }

    /// Soort op grond van de eerste bytes (gelijk aan sniff in supabase/functions/admin/image.ts).
    static func kind(of d: Data) -> Kind {
        let b = [UInt8](d.prefix(16))
        if b.count >= 8, Array(b[0...7]) == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] { return .png }
        if b.count >= 3, b[0] == 0xFF, b[1] == 0xD8, b[2] == 0xFF { return .jpeg }
        if b.count >= 6, Array(b[0...3]) == [0x47, 0x49, 0x46, 0x38], b[4] == 0x37 || b[4] == 0x39, b[5] == 0x61 { return .gif }
        if b.count >= 12, Array(b[0...3]) == [0x52, 0x49, 0x46, 0x46], Array(b[8...11]) == [0x57, 0x45, 0x42, 0x50] { return .webp }
        let head = String(decoding: d.prefix(512), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if head.hasPrefix("<svg") || (head.hasPrefix("<?xml") && head.contains("<svg")) { return .svg }
        return .other
    }

    /// Klaarmaken; foutcode (zelfde codes als de functie admin) bij een probleem.
    static func prepare(_ data: Data) -> Result<Prepared, APIError> {
        func fail(_ c: String) -> Result<Prepared, APIError> { .failure(APIError(code: c, status: 0, body: .null)) }
        let k = kind(of: data)
        switch k {
        case .svg: return fail("image_svg")
        case .webp: return fail("image_webp")
        case .gif:
            guard data.count <= maxBytes else { return fail("image_too_large") }
            let size = UIImage(data: data)?.size ?? .zero
            return .success(Prepared(data: data, kind: .gif, pixels: size, resizedFrom: nil))
        default: break
        }
        guard let img = UIImage(data: data), img.size.width > 0, img.size.height > 0 else { return fail("bad_image_data") }
        // UIImage.size is in punten met scale; in pixels rekenen
        let px = CGSize(width: img.size.width * img.scale, height: img.size.height * img.scale)
        if (k == .png || k == .jpeg) && px.width <= maxWidth && data.count <= maxBytes && img.imageOrientation == .up {
            return .success(Prepared(data: data, kind: k, pixels: px, resizedFrom: nil))
        }
        let scale = min(1, maxWidth / px.width)
        let target = CGSize(width: max(1, (px.width * scale).rounded()), height: max(1, (px.height * scale).rounded()))
        let bg = UIColor(red: 0x14 / 255, green: 0x14 / 255, blue: 0x14 / 255, alpha: 1)
        func render(opaque: Bool) -> UIImage {
            let fmt = UIGraphicsImageRendererFormat()
            fmt.scale = 1
            fmt.opaque = opaque
            return UIGraphicsImageRenderer(size: target, format: fmt).image { ctx in
                if opaque { bg.setFill(); ctx.fill(CGRect(origin: .zero, size: target)) }
                img.draw(in: CGRect(origin: .zero, size: target))
            }
        }
        var out: Data?
        var kindOut: Kind = .jpeg
        if k == .png, let p = render(opaque: false).pngData(), p.count <= maxBytes {
            out = p
            kindOut = .png
        } else {
            // als JPG (ook een te grote PNG: dan op de achtergrondkleur van de mail)
            let flat = render(opaque: true)
            for q in [0.86, 0.78, 0.68, 0.58] as [CGFloat] {
                if let j = flat.jpegData(compressionQuality: q) {
                    out = j
                    if j.count <= maxBytes { break }
                }
            }
        }
        guard let result = out else { return fail("bad_image_data") }
        guard result.count <= maxBytes else { return fail("image_too_large") }
        return .success(Prepared(data: result, kind: kindOut, pixels: target, resizedFrom: scale < 1 ? Int(px.width) : nil))
    }

    /// Foutmelding bij een afbeelding, met de deeldienst erbij als die bekend is (Google, iCloud, Dropbox, …).
    static func message(_ code: String, service: String?) -> String {
        if code == "image_share_link", let s = service, !s.isEmpty {
            return "Deze link is een deelpagina van \(s), geen afbeelding. Upload de afbeelding hier of gebruik een directe link naar een PNG, JPG of GIF."
        }
        return APIError.text(code)
    }

    static func typeName(_ t: String) -> String {
        ["image/png": "PNG", "image/jpeg": "JPG", "image/gif": "GIF"][t] ?? t
    }

    static func size(_ n: Int) -> String {
        n >= 1024 * 1024
            ? String(format: "%.1f MB", Double(n) / 1_048_576).replacingOccurrences(of: ".", with: ",")
            : "\(max(1, Int((Double(n) / 1024).rounded()))) kB"
    }
}
