import Foundation

/// Eén build uit builds/manifest.json (actie `builds`): de nieuwste van een platform of een oudere uit `history`.
struct BuildInfo: Identifiable, Hashable {
    let file: String
    let version: String?
    let build: String?
    let date: Date?
    /// Moment van plaatsen op de server (`uploaded_at`, workflow Builds); ontbreekt bij oudere builds.
    let uploadedAt: Date?
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
        uploadedAt = j["uploaded_at"].date
        size = j["size"].int
        sha256 = j["sha256"].text
        notes = j["notes"].text
    }

    /// "build 105" (of de bestandsnaam als het buildnummer ontbreekt).
    var title: String { build.map { "build \($0)" } ?? file }

    /// Versie, datum en grootte op één regel (voor oudere builds).
    var detail: String {
        [version, when, size.map { BuildInfo.sizeText($0) }].compactMap { $0 }.joined(separator: " · ")
    }

    /// Geüpload als datum en tijd (NL-tijd), anders alleen de datum uit het pakket.
    var when: String? {
        if let uploadedAt { return Fmt.dateTimeNL(uploadedAt) }
        return date.map { Fmt.date($0) }
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
        ("android-aab", "Android App Bundle (Google Play)", ".aab voor Google Play (telefoon, tablet en Google TV), getekend met de upload key", "shippingbox"),
        ("windows", "Windows (.exe)", "Installer voor Windows 10 en 11 (x64)", "pc"),
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

    /// Platforms in Downloads met een releasemelding, met wie hem krijgt (Windows en BingrBeheer hebben geen push).
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
    /// PressKit (los van de buildplatforms; nil als er nog geen presskit op de server staat)
    let presskit: PresskitOverview?
    /// Openbare Windows-installer (bingr.online/windows) met downloadteller per build; nil als er geen Windows-build is
    let windowsPublic: PublicDownloadStats?

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
        presskit = PresskitOverview(platform: p["presskit"], info: j["presskit"])
        windowsPublic = j["windows_public"].object == nil ? nil : PublicDownloadStats(j["windows_public"], fallback: "https://bingr.online/windows")
    }

    /// Tekst voor de lege of niet-ingerichte toestand (nil als er builds zijn).
    var emptyText: String? {
        if ready && (platforms.contains(where: { $0.latest != nil }) || presskit != nil) { return nil }
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

/// PressKit in Downloads (actie `builds` → `platforms.presskit` en `presskit`): de nieuwste Bingr-PressKit.zip (workflow
/// PressKit), de openbare link (bingr.online/presskit) en de downloadteller (alleen aantallen, uit builds/presskit-stats.json).
struct PresskitOverview {
    struct Day: Identifiable, Hashable {
        let date: Date
        let count: Int
        var id: Date { date }
    }

    let build: BuildInfo
    let publicURL: URL
    /// nil = nog geen teller op de server
    let total: Int?
    let versionTotal: Int
    let last7: Int
    let last30: Int
    let days: [Day]

    init?(platform p: JSON, info j: JSON) {
        guard let b = BuildInfo(p) else { return nil }
        build = b
        publicURL = j["public_url"].text.flatMap { URL(string: $0) }.flatMap { $0.scheme == "https" ? $0 : nil }
            ?? URL(string: "https://bingr.online/presskit")!
        let s = j["stats"]
        if s.object != nil {
            total = s["total"].int ?? 0
            versionTotal = s["version_total"].int ?? 0
            last7 = s["last_7d"].int ?? 0
            last30 = s["last_30d"].int ?? 0
            let f = DateFormatter()
            f.calendar = Calendar(identifier: .gregorian)
            f.locale = Locale(identifier: "en_US_POSIX")
            f.timeZone = Fmt.amsterdam
            f.dateFormat = "yyyy-MM-dd"
            days = s["days"].array.compactMap { d in
                guard let t = d["date"].text, let date = f.date(from: t) else { return nil }
                return Day(date: date, count: max(0, d["n"].int ?? 0))
            }
        } else {
            total = nil; versionTotal = 0; last7 = 0; last30 = 0; days = []
        }
    }
}

/// Openbare download zonder inloggen (actie `builds` → `windows_public`): de link en de teller (alleen aantallen, per build,
/// uit builds/windows-stats.json via dl.php ?app=windows).
struct PublicDownloadStats {
    let publicURL: URL
    /// nil = nog geen teller op de server
    let total: Int?
    let buildTotal: Int
    let last7: Int
    let last30: Int

    init(_ j: JSON, fallback: String) {
        publicURL = j["public_url"].text.flatMap { URL(string: $0) }.flatMap { $0.scheme == "https" ? $0 : nil }
            ?? URL(string: fallback)!
        let s = j["stats"]
        if s.object != nil {
            total = s["total"].int ?? 0
            buildTotal = s["version_total"].int ?? 0
            last7 = s["last_7d"].int ?? 0
            last30 = s["last_30d"].int ?? 0
        } else {
            total = nil; buildTotal = 0; last7 = 0; last30 = 0
        }
    }
}
