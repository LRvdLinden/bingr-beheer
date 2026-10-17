import Foundation

/// Eén build uit builds/manifest.json (actie `builds`): de nieuwste van een platform of een oudere uit `history`.
struct BuildInfo: Identifiable, Hashable {
    let file: String
    let version: String?
    let build: String?
    let date: Date?
    let size: Int?
    let sha256: String?
    let notes: String?

    var id: String { file }

    init?(_ j: JSON) {
        guard let f = j["file"].text else { return nil }
        file = f
        version = j["version"].text
        build = j["build"].text
        date = j["date"].date
        size = j["size"].int
        sha256 = j["sha256"].text
        notes = j["notes"].text
    }

    /// "build 105" (of de bestandsnaam als het buildnummer ontbreekt).
    var title: String { build.map { "build \($0)" } ?? file }

    /// Versie, datum en grootte op één regel (voor oudere builds).
    var detail: String {
        [version, date.map { Fmt.date($0) }, size.map { BuildInfo.sizeText($0) }].compactMap { $0 }.joined(separator: " · ")
    }

    static func sizeText(_ n: Int?) -> String {
        guard let n, n >= 0 else { return "—" }
        let f = ByteCountFormatter()
        f.countStyle = .file
        return f.string(fromByteCount: Int64(n))
    }
}

/// Een platform op de tab Downloads, met de nieuwste build en oudere builds die nog op de server staan.
struct BuildPlatform: Identifiable {
    let key: String
    let latest: BuildInfo?
    let history: [BuildInfo]

    var id: String { key }

    /// Volgorde en teksten zoals DL_PLATFORMS in web/admin.js.
    static let all: [(key: String, title: String, hint: String, icon: String)] = [
        ("android", "Android en Android TV", "APK voor telefoons, tablets, Android TV, Google TV en Fire TV", "apps.iphone"),
        ("tizen", "Samsung TV", ".wgt voor Tizen", "tv"),
        ("apple", "Apple", "Xcode-project (zip) voor iOS, iPadOS, tvOS en macOS", "apple.logo"),
        ("beheer", "BingrBeheer", "Xcode-project (zip) van deze app voor iPhone en iPad", "wrench.and.screwdriver"),
    ]

    var title: String { Self.all.first { $0.key == key }?.title ?? key }
    var hint: String { Self.all.first { $0.key == key }?.hint ?? "" }
    var icon: String { Self.all.first { $0.key == key }?.icon ?? "shippingbox" }
}

/// Verstuurde releasemelding van één build (actie `builds` → `release_push["apple:114"]`, of `build_push` → `push`).
struct ReleasePushState: Hashable {
    let sentAt: Date?
    let devices: Int
    let queued: Int
    let sent: Int
    let failed: Int
    let done: Bool

    init(_ j: JSON) {
        sentAt = j["sent_at"].date
        devices = j["devices"].int ?? 0
        queued = j["queued"].int ?? 0
        sent = j["sent"].int ?? 0
        failed = j["failed"].int ?? 0
        done = j["done"].bool ?? (queued == 0)
    }

    /// "12 apparaten, 11 verstuurd, 1 mislukt"
    var counts: String {
        var bits = ["\(Fmt.num(devices)) apparaten"]
        if sent > 0 { bits.append("\(Fmt.num(sent)) verstuurd") }
        if failed > 0 { bits.append("\(Fmt.num(failed)) mislukt") }
        if !done && queued > 0 { bits.append("\(Fmt.num(queued)) in wachtrij") }
        return bits.joined(separator: ", ")
    }

    /// Platforms in Downloads met een releasemelding, met wie hem krijgt (Samsung TV en BingrBeheer hebben geen push).
    static let audience: [String: String] = ["apple": "iPhone, iPad en Mac", "android": "Android-telefoons en -tablets"]
}

/// Antwoord van `builds`: {ready, platforms, updated?, reason?, release_push?}.
struct BuildsOverview {
    let ready: Bool
    let reason: String?
    let updated: Date?
    let platforms: [BuildPlatform]
    /// verstuurde releasemeldingen per "platform:build"
    var pushes: [String: ReleasePushState]

    init(_ j: JSON) {
        ready = j["ready"].bool ?? false
        reason = j["reason"].text
        updated = j["updated"].date
        let p = j["platforms"]
        platforms = BuildPlatform.all.map { def in
            let e = p[def.key]
            return BuildPlatform(key: def.key, latest: BuildInfo(e), history: e["history"].array.compactMap { BuildInfo($0) })
        }
        pushes = (j["release_push"].object ?? [:]).mapValues { ReleasePushState($0) }
    }

    /// Tekst voor de lege of niet-ingerichte toestand (nil als er builds zijn).
    var emptyText: String? {
        if ready && platforms.contains(where: { $0.latest != nil }) { return nil }
        switch reason {
        case "not_configured": return "Downloads nog niet ingericht: draai de workflow Builds."
        case "unreachable": return "De server met de builds is niet bereikbaar. Probeer het later opnieuw."
        default: return "Nog geen builds op de server."
        }
    }
}

/// Antwoord van `build_link`: een downloadlink van 10 minuten (https://beheer.bingr.online/dl.php?t=…).
struct BuildLink: Identifiable {
    let url: URL
    let expiresAt: Date?
    let file: String
    let size: Int?

    var id: String { url.absoluteString }

    init?(_ j: JSON) {
        guard let s = j["url"].text, let u = URL(string: s), u.scheme == "https" else { return nil }
        url = u
        expiresAt = j["expires_at"].date
        file = j["file"].text ?? u.lastPathComponent
        size = j["size"].int
    }
}
