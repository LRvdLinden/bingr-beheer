import Foundation

/// Tellers van `support_counts` (ook `counts` in `support_list`).
struct SupportCounts: Equatable {
    let new, open, pending, resolved, closed, active, unread, total, last7d: Int
    let smtp: Bool?

    init(_ j: JSON) {
        new = j["new"].int ?? 0
        open = j["open"].int ?? 0
        pending = j["pending"].int ?? 0
        resolved = j["resolved"].int ?? 0
        closed = j["closed"].int ?? 0
        active = j["active"].int ?? 0
        unread = j["unread"].int ?? 0
        total = j["total"].int ?? 0
        last7d = j["last_7d"].int ?? 0
        smtp = j["smtp"].bool
    }

    func count(for filter: String) -> Int? {
        switch filter {
        case "active": return active
        case "new": return new
        case "open": return open
        case "pending": return pending
        case "resolved": return resolved
        case "closed": return closed
        case "all": return total
        default: return nil
        }
    }

    /// Ondertitel van de tegel "Open tickets".
    var hint: String {
        unread > 0 ? "\(Fmt.num(unread)) wacht\(unread == 1 ? "" : "en") op reactie" : "\(Fmt.num(last7d)) nieuw in 7 dagen"
    }
}

/// Rij uit `support_list`.
struct TicketRow: Identifiable, Hashable {
    var id: Int { number }
    let number: Int
    let subject: String
    let email: String
    let name: String?
    let status: String
    let priority: String
    let category: String
    let platform: String?
    let createdAt: Date?
    let lastReplyAt: Date?
    let hasAccount: Bool
    let unread: Bool
    /// build 146: `app` voor een ticket uit de Support-tab van de app
    let source: String?

    init(_ j: JSON) {
        number = j["number"].int ?? 0
        subject = j["subject"].text ?? ""
        email = j["email"].text ?? ""
        name = j["name"].text
        status = j["status"].text ?? "new"
        priority = j["priority"].text ?? "normal"
        category = j["category"].text ?? "overig"
        platform = j["platform"].text
        createdAt = j["created_at"].date
        lastReplyAt = j["last_reply_at"].date
        hasAccount = j["has_account"].bool ?? false
        unread = j["unread"].bool ?? false
        source = j["source"].text
    }
}

/// Antwoord van `support_get`.
struct TicketDetail {
    struct Message: Identifiable {
        let id: Int
        /// customer | support | note | event
        let author: String
        let body: String
        let createdAt: Date?
        let emailSent: Bool?
        let emailError: String?
        let source: String?
        /// build 146: diagnose-bijlage (alleen in het beheer volledig)
        let diagnostics: TicketDiagnostics?
    }

    struct Account {
        let linked: Bool
        let deviceCount: Int
        let platforms: [String]
        let appVersions: [String]
        let createdAt: Date?
        let lastSeenAt: Date?
        let confirmed: Bool
        let tickets: Int
    }

    let number: Int
    let subject: String
    let email: String
    let name: String?
    let status: String
    let priority: String
    let category: String
    let platform: String?
    let appVersion: String?
    let deviceName: String?
    let osVersion: String?
    /// build 146: soort (phone, tablet, tv, desktop, browser) en model uit de diagnose-bijlage; `app` = via de app
    let deviceType: String?
    let deviceModel: String?
    let source: String?
    let lang: String
    let customerURL: URL?
    let createdAt: Date?
    let messages: [Message]
    let account: Account?
    let smtp: Bool?

    init(_ j: JSON) {
        let t = j["ticket"]
        number = t["number"].int ?? 0
        subject = t["subject"].text ?? ""
        email = t["email"].text ?? ""
        name = t["name"].text
        status = t["status"].text ?? "new"
        priority = t["priority"].text ?? "normal"
        category = t["category"].text ?? "overig"
        platform = t["platform"].text
        appVersion = t["app_version"].text
        deviceName = t["device_name"].text
        osVersion = t["os_version"].text
        deviceType = t["device_type"].text
        deviceModel = t["device_model"].text
        source = t["source"].text
        lang = t["lang"].text ?? "nl"
        customerURL = t["customer_url"].text.flatMap(URL.init(string:))
        createdAt = t["created_at"].date
        messages = j["messages"].array.enumerated().map { i, m in
            Message(id: i, author: m["author"].text ?? "", body: m["body"].string ?? "", createdAt: m["created_at"].date,
                    emailSent: m["email_sent"].bool, emailError: m["email_error"].text, source: m["source"].text,
                    diagnostics: TicketDiagnostics(m["diagnostics"]))
        }
        let a = j["account"]
        account = a.object == nil ? nil : Account(
            linked: a["linked"].bool ?? false, deviceCount: a["device_count"].int ?? 0, platforms: a["platforms"].strings,
            appVersions: a["app_versions"].strings, createdAt: a["created_at"].date, lastSeenAt: a["last_seen_at"].date,
            confirmed: a["confirmed"].bool ?? true, tickets: a["tickets"].int ?? 0)
        smtp = j["smtp"].bool
    }

    /// Apparaat in één regel: soort, model, systeem, naam (zoals het web-dashboard).
    var deviceLine: String? {
        let s = [deviceType.map(Labels.deviceType), deviceModel, osVersion, deviceName].compactMap { $0 }.joined(separator: " · ")
        return s.isEmpty ? nil : s
    }
}

/// Diagnose-bijlage bij een bericht uit de app (schema 1, 2 en 3, docs/ACCOUNT.md "Build 146", "Build 147" en "Build 148" in iptv-ios-appletv).
/// Alle velden optioneel: de server heeft de bijlage al opgeschoond; hier alleen lezen en netjes tonen.
struct TicketDiagnostics {
    struct Milestone: Identifiable { let id: Int; let name: String; let ms: Int?; let ok: Bool? }
    /// build 147: ophalen per server en soort (live, movie, series): ok, empty, failed, hidden
    struct Fetch: Identifiable {
        let id: Int; let server: String; let kind: String; let status: String; let count: Int?; let error: String?
        // build 148 (schema 3): geleverd, zichtbaar en waarom verborgen
        var delivered: Int? = nil; var visible: Int? = nil
        var hiddenCategories: Int? = nil; var hiddenKids: Int? = nil; var hiddenDuplicates: Int? = nil; var hiddenOther: Int? = nil
    }
    /// build 148: één keer bijwerken van een server, met fasen (fetch, parse, index, apply, save)
    struct Phase: Identifiable { let id: Int; let code: String; let ms: Int?; let memMB: Double? }
    /// build 148: hapering tijdens het afspelen (playback.stalls, code playback_stall)
    struct Stall: Identifiable { let id: Int; let atMs: Int; let ms: Int; let engine: String?; let format: String? }
    struct Update: Identifiable { let id: Int; let server: String; let at: Date?; let phases: [Phase]; let totalMs: Int?; let peakMB: Double?; let result: String? }

    let kind: String
    let createdAt: Date?
    let platform: String?, version: String?, build: Int?, engine: String?
    let deviceType: String?, model: String?, manufacturer: String?, os: String?, osVersion: String?, language: String?, browser: String?, screen: String?
    let milestones: [Milestone]
    let memUsedMB: Double?, memTotalMB: Double?, memAppMB: Double?, lowMemory: Bool?
    let crashAt: Date?, crashType: String?, crashReason: String?, crashStack: [String], crashBuild: Int?, hasCrash: Bool
    let signedIn: Bool?, profiles: Int?, servers: Int?, serverKinds: [String], lastSync: Date?, lastSyncOk: Bool?, plan: String?, pushEnabled: Bool?
    let channels: Int?, movies: Int?, series: Int?, uptimeS: Int?
    let online: Bool?, netType: String?, backend: String?, backendMs: Int?, provider: String?, providerMs: Int?, vpn: Bool?
    let storageUsedMB: Double?, storageFreeMB: Double?, cacheMB: Double?, dbMB: Double?
    // build 147 (schema 2)
    let schema: Int
    let startSummary: String?, appMs: Int?, userWaitMs: Int?, maxHangMs: Int?, hasStart: Bool
    let prevProblem: String?, prevMilestone: String?, prevSeconds: Double?, prevForeground: Bool?, prevTask: String?
    let prevAt: Date?, prevBuild: Int?, prevStack: [String]
    let fetch: [Fetch]
    let totalMB: Double?, catalogMB: Double?, downloadsMB: Double?, hasStorage2: Bool
    // build 148 (schema 3)
    let appLang: String?
    let hangMs: Int?, hangTask: String?, hangMilestone: String?, hangForeground: Bool?, hangStack: [String], hasLongestHang: Bool
    let updates: [Update]
    let stalls: [Stall]

    init?(_ j: JSON) {
        guard j.object != nil, let kind = j["kind"].text else { return nil }
        self.kind = kind
        createdAt = j["createdAt"].date
        let a = j["app"], d = j["device"], m = j["memory"], c = j["crash"], s = j["state"]
        // schema 2: network en storage bovenaan; schema 1: in state
        let n = j["network"].object != nil ? j["network"] : s["network"]
        let st2 = j["storage"], st = s["storage"]
        schema = j["schema"].int ?? 1
        let sp = j["start"], p = sp["previous"]
        hasStart = sp.object != nil
        startSummary = sp["summary"].text; appMs = sp["appMs"].int; userWaitMs = sp["userWaitMs"].int; maxHangMs = sp["maxHangMs"].int
        prevProblem = p["problem"].text; prevMilestone = p["milestone"].text; prevSeconds = p["seconds"].double
        prevForeground = p["foreground"].bool; prevTask = p["task"].text; prevAt = p["at"].date; prevBuild = p["build"].int
        prevStack = p["stack"].strings
        fetch = j["fetch"].array.enumerated().compactMap { i, x in
            guard let server = x["server"].text, let kind = x["kind"].text, let status = x["status"].text else { return nil }
            let h = x["hidden"]
            return Fetch(id: i, server: server, kind: kind, status: status, count: x["count"].int, error: x["error"].text,
                         delivered: x["delivered"].int, visible: x["visible"].int, hiddenCategories: h["categories"].int, hiddenKids: h["kids"].int,
                         hiddenDuplicates: h["duplicates"].int, hiddenOther: h["other"].int)
        }
        let lh = sp["longestHang"]
        hasLongestHang = lh.object != nil
        hangMs = lh["ms"].int; hangTask = lh["task"].text; hangMilestone = lh["milestone"].text; hangForeground = lh["foreground"].bool
        hangStack = lh["stack"].strings
        appLang = j["app"]["lang"].text
        stalls = j["playback"]["stalls"].array.enumerated().compactMap { i, x in
            guard let at = x["atMs"].int, let ms = x["ms"].int else { return nil }
            return Stall(id: i, atMs: at, ms: ms, engine: x["engine"].text, format: x["format"].text)
        }
        updates = j["updates"].array.enumerated().compactMap { i, u in
            guard let server = u["server"].text else { return nil }
            let phases: [Phase] = u["phases"].array.enumerated().compactMap { k, ph in
                ph["code"].text.map { Phase(id: k, code: $0, ms: ph["ms"].int, memMB: ph["memMB"].double) }
            }
            return Update(id: i, server: server, at: u["at"].date, phases: phases, totalMs: u["totalMs"].int, peakMB: u["peakMB"].double, result: u["result"].text)
        }
        hasStorage2 = st2.object != nil
        totalMB = st2["totalMB"].double; catalogMB = st2["catalogMB"].double; downloadsMB = st2["downloadsMB"].double
        platform = a["platform"].text; version = a["version"].text; build = a["build"].int; engine = a["engine"].text
        deviceType = d["type"].text; model = d["model"].text; manufacturer = d["manufacturer"].text; os = d["os"].text
        osVersion = d["osVersion"].text; language = d["language"].text; browser = d["browser"].text; screen = d["screen"].text
        milestones = j["milestones"].array.enumerated().compactMap { i, x in
            (x["code"].text ?? x["name"].text).map { Milestone(id: i, name: $0, ms: x["ms"].int, ok: x["ok"].bool) }
        }
        memUsedMB = m["usedMB"].double; memTotalMB = m["totalMB"].double; memAppMB = m["appMB"].double; lowMemory = m["lowMemory"].bool
        hasCrash = c.object != nil
        crashAt = c["at"].date; crashType = c["type"].text; crashReason = c["reason"].text; crashStack = c["stack"].strings; crashBuild = c["build"].int
        signedIn = s["signedIn"].bool; profiles = s["profiles"].int; servers = s["servers"].int; serverKinds = s["serverKinds"].strings
        lastSync = s["lastSync"].date; lastSyncOk = s["lastSyncOk"].bool; plan = s["plan"].text; pushEnabled = s["pushEnabled"].bool
        channels = s["channels"].int; movies = s["movies"].int; series = s["series"].int; uptimeS = s["uptimeS"].int
        online = n["online"].bool; netType = n["type"].text; backend = n["backend"].text; backendMs = n["backendMs"].int
        provider = n["provider"].text; providerMs = n["providerMs"].int; vpn = n["vpn"].bool
        storageUsedMB = st["usedMB"].double
        storageFreeMB = hasStorage2 ? st2["freeMB"].double : st["freeMB"].double
        cacheMB = hasStorage2 ? st2["cacheMB"].double : st["cacheMB"].double
        dbMB = st["dbMB"].double
    }

    // MARK: build 147

    /// Samenvatting van de start (goed, traag, vastgelopen) met toon.
    var startLabel: (String, Tone)? {
        switch startSummary {
        case "good": return ("Start: goed", .good)
        case "slow": return ("Start: traag", .warn)
        case "hung": return ("Start: vastgelopen", .bad)
        default: return nil
        }
    }
    static func problemLabel(_ p: String?) -> String? {
        let labels: [String: String] = ["hang": "Vastgelopen", "crash": "Crash", "not_finished": "Niet klaar"]
        return labels[p ?? ""]
    }
    /// Probleem bij de vorige start (hang, crash, niet klaar): details in één regel; nil als er geen is.
    var previousProblemDetail: String? {
        guard Self.problemLabel(prevProblem) != nil else { return nil }
        let parts: [String?] = [
            prevMilestone.map { "fase " + Self.milestoneName($0) }, prevSeconds.map { "duur " + Self.sec($0) },
            prevForeground.map { $0 ? "op de voorgrond" : "op de achtergrond" }, prevTask.map { "taak: " + (Self.codes[$0] != nil ? Self.milestoneName($0) : $0) },
            prevBuild.map { "build \($0)" }, prevAt.map { Fmt.dateTime($0) },
        ]
        return parts.compactMap { $0 }.joined(separator: " · ")
    }
    var hasPreviousProblem: Bool { Self.problemLabel(prevProblem) != nil }

    /// build 148: codes van schema 3 (vaste lijst in docs/ACCOUNT.md "Build 148") en de oude namen van schema 1/2, in het Nederlands
    /// (gelijk aan MILE in web/admin.js)
    static let codes: [String: String] = [
        "started": "gestart", "storage": "opslag geladen", "account": "account", "first_frame": "eerste beeld", "intro_done": "intro klaar",
        "profile_picker": "profielkeuze getoond", "profile_picked": "profiel gekozen", "pin_screen": "pincodescherm", "pin_ok": "pincode goed",
        "profile": "profiel geladen", "servers": "servers geladen", "home": "startscherm", "catalog": "catalogus geladen", "ready": "klaar",
        "fetch": "ophalen", "parse": "inlezen", "index": "indexeren", "apply": "toepassen", "save": "bewaren", "sync_apply": "sync toepassen",
        "catalog_filter": "catalogus filteren", "catalog_sort": "catalogus sorteren", "catalog_meta": "catalogusgegevens", "pin_migrate": "pincode migreren",
        "rows_build": "rijen opbouwen", "guide_parse": "tv-gids inlezen", "playback_stall": "hapering tijdens afspelen",
        // schema 1/2
        "launch": "gestart", "start": "gestart", "session": "account", "intro": "intro klaar", "profiles": "profielkeuze getoond",
        "profile_chosen": "profiel gekozen", "pin": "pincodescherm", "servers_loaded": "servers geladen", "epg": "tv-gids", "splash": "opstartscherm",
        "sources": "bronnen", "keychain": "sleutelhanger", "ophalen_open_server": "ophalen (open server)", "bewaard": "bewaard", "klaar": "klaar",
    ]
    static func milestoneName(_ n: String) -> String {
        codes[n].map { "\($0) (\(n))" } ?? n
    }
    /// Alleen de Nederlandse naam (fasen): "toepassen"
    static func codeName(_ n: String) -> String { codes[n] ?? n.replacingOccurrences(of: "_", with: " ") }
    static func langName(_ l: String) -> String {
        let names: [String: String] = ["nl": "Nederlands", "en": "Engels", "de": "Duits", "fr": "Frans", "es": "Spaans", "it": "Italiaans",
                                       "pt": "Portugees", "pl": "Pools", "tr": "Turks", "ar": "Arabisch"]
        let base = String(l.split(separator: "-").first ?? Substring(l))
        return (names[base] ?? l) + " (\(l))"
    }
    static func resultLabel(_ r: String?) -> (String, Tone)? {
        switch r {
        case "ok": return ("gelukt", .good)
        case "failed": return ("mislukt", .bad)
        case "cancelled": return ("afgebroken", .warn)
        default: return nil
        }
    }
    /// Langste hang van deze start: "5,5 s · taak toepassen (apply) · na klaar (ready) · op de voorgrond"
    var longestHangText: String? {
        guard hasLongestHang else { return nil }
        let parts: [String?] = [hangMs.map { Self.ms($0) }, hangTask.map { "taak " + Self.milestoneName($0) },
                                hangMilestone.map { "na " + Self.milestoneName($0) }, hangForeground.map { $0 ? "op de voorgrond" : "op de achtergrond" }]
        let s = parts.compactMap { $0 }.joined(separator: " · ")
        return s.isEmpty ? nil : s
    }
    static func afterStart(_ v: Int) -> String {
        v >= 60000 ? "na " + String(format: "%.1f min", Double(v) / 60000).replacingOccurrences(of: ".", with: ",") : "na " + ms(v)
    }
    /// "3 haperingen · langste 2,3 s (na 2,1 min) · samen 3,4 s"
    var stallsText: String? {
        guard let longest = stalls.max(by: { $0.ms < $1.ms }) else { return nil }
        let total = stalls.reduce(0) { $0 + $1.ms }
        return Fmt.num(stalls.count) + (stalls.count == 1 ? " hapering" : " haperingen") + " · langste " + Self.ms(longest.ms)
            + " (" + Self.afterStart(longest.atMs) + ") · samen " + Self.ms(total)
    }
    static func stallLine(_ x: Stall) -> String {
        [afterStart(x.atMs), ms(x.ms), x.engine.map { "speler " + $0 }, x.format].compactMap { $0 }.joined(separator: " · ")
    }
    /// "s1 · 24-10 14:04 · gelukt · totaal 21,5 s · piek 455 MB"
    static func updateHead(_ u: Update) -> String {
        let parts: [String?] = [u.server, u.at.map { Fmt.dateTime($0) }, resultLabel(u.result)?.0 ?? u.result,
                                u.totalMs.map { "totaal " + ms($0) }, mb(u.peakMB).map { "piek " + $0 }]
        return parts.compactMap { $0 }.joined(separator: " · ")
    }
    static func phaseText(_ p: Phase) -> String {
        [p.ms.map { ms($0) }, mb(p.memMB)].compactMap { $0 }.joined(separator: " · ")
    }
    /// "36.593 geleverd · 10.286 zichtbaar (26.307 verborgen door categorieën)"; nil zonder delivered/visible (schema 1/2)
    static func deliveredText(_ f: Fetch) -> String? {
        guard f.delivered != nil || f.visible != nil else { return nil }
        let main = [f.delivered.map { Fmt.num($0) + " geleverd" }, f.visible.map { Fmt.num($0) + " zichtbaar" }].compactMap { $0 }.joined(separator: " · ")
        var why: [String] = []
        if let n = f.hiddenCategories, n > 0 { why.append(Fmt.num(n) + " verborgen door categorieën") }
        if let n = f.hiddenKids, n > 0 { why.append(Fmt.num(n) + " verborgen door kinderfilter") }
        if let n = f.hiddenDuplicates, n > 0 { why.append(Fmt.num(n) + " dubbel") }
        if let n = f.hiddenOther, n > 0 { why.append(Fmt.num(n) + " overig") }
        return main + (why.isEmpty ? "" : " (" + why.joined(separator: ", ") + ")")
    }
    /// "series: provider leverde niets", "films: mislukt (timeout)"
    static func fetchText(_ f: Fetch) -> String {
        let kinds: [String: String] = ["live": "zenders", "movie": "films", "series": "series"]
        let kind = kinds[f.kind] ?? f.kind
        let n = f.count.map { Fmt.num($0) }
        let st: String
        switch f.status {
        case "ok": st = "geleverd" + (n.map { " (\($0))" } ?? "")
        case "empty": st = "provider leverde niets"
        case "failed": st = "mislukt" + (f.error.map { " (\($0))" } ?? "")
        case "hidden": st = "alles verborgen" + (n.map { " (\($0))" } ?? "")
        default: st = f.status
        }
        return "\(kind): \(st)"
    }
    static func fetchTone(_ s: String) -> Tone {
        let tones: [String: Tone] = ["ok": .good, "empty": .warn, "failed": .bad, "hidden": .warn]
        return tones[s] ?? .neutral
    }

    static func sec(_ v: Double) -> String { String(format: "%.1f s", v).replacingOccurrences(of: ".", with: ",") }
    static func ms(_ v: Int) -> String {
        v >= 1000 ? String(format: "%.1f s", Double(v) / 1000).replacingOccurrences(of: ".", with: ",") : "\(v) ms"
    }
    static func mb(_ v: Double?) -> String? {
        guard let v else { return nil }
        if v >= 1024 { return String(format: "%.1f GB", v / 1024).replacingOccurrences(of: ".", with: ",") }
        return Fmt.num(Int(v.rounded())) + " MB"
    }

    /// De hele diagnose als nette, leesbare tekst (knop Kopiëren), zoals diagText in web/admin.js.
    var plainText: String {
        var L: [String] = []
        func join(_ x: [String?]) -> String { x.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ") }
        func line(_ k: String, _ v: String?) { if let v, !v.isEmpty { L.append("\(k): \(v)") } }
        let made: String = createdAt.map { ", gemaakt " + Fmt.dateTime($0) } ?? ""
        L.append("Bingr-diagnose: \(kindLabel) (schema \(schema))" + made)
        L.append("")
        let devParts: [String?] = [deviceType.map(Labels.deviceType), model, manufacturer, systemLine, language, browser, screen]
        line("Apparaat", join(devParts))
        let buildText: String = build.map { " (build \($0))" } ?? ""
        let appVersion: String? = version.map { "Bingr " + $0 + buildText }
        line("App", join([platform.map(Labels.diagPlatform), appVersion, engine.map { "speler " + $0 }, appLang.map { "app-taal " + Self.langName($0) }]))
        line("Samenvatting", startLabel?.0)
        if let label = Self.problemLabel(prevProblem) { line("PROBLEEM VORIGE START", join([label, previousProblemDetail])) }
        if hasStart {
            L += ["", "Startdiagnose"]
            let curParts: [String?] = [appMs.map { "app-tijd " + Self.ms($0) }, userWaitMs.map { "wachten op de gebruiker " + Self.ms($0) },
                                       maxHangMs.map { "langste hang " + Self.ms($0) }]
            let cur = join(curParts)
            L.append("  Deze start: " + (cur.isEmpty ? "—" : cur))
            if let h = longestHangText { L.append("  Langste hang deze start: " + h) }
            if !hangStack.isEmpty { L.append("  Stack hoofdthread (deze start):"); L += hangStack.map { "    " + $0 } }
            var prev: String = prevProblem ?? "—"
            if prevProblem == "none" { prev = "geen probleem" } else if let label = Self.problemLabel(prevProblem) { prev = join([label, previousProblemDetail]) }
            L.append("  Vorige start: " + prev)
            if !prevStack.isEmpty { L.append("  Stack hoofdthread:"); L += prevStack.map { "    " + $0 } }
        }
        if !milestones.isEmpty {
            L += ["", "Mijlpalen"]
            for m in milestones {
                let t: String = m.ms.map { Self.ms($0) } ?? "?"
                L.append("  " + Self.milestoneName(m.name) + ": " + t + (m.ok == false ? " (mislukt)" : ""))
            }
        }
        if let t = stallsText {
            L += ["", "Haperingen tijdens het afspelen", "  " + t]
            L += stalls.map { "    " + Self.stallLine($0) }
        }
        if !updates.isEmpty {
            L += ["", "Bijwerken per server (laatste 5)"]
            for u in updates {
                L.append("  " + Self.updateHead(u))
                for p in u.phases {
                    let t = Self.phaseText(p)
                    L.append("    " + Self.codeName(p.code) + ": " + (t.isEmpty ? "?" : t.replacingOccurrences(of: " · ", with: ", ")))
                }
            }
        }
        var memParts: [String?] = []
        if let u = Self.mb(memUsedMB) {
            let total: String = Self.mb(memTotalMB).map { " van " + $0 } ?? ""
            memParts.append("gebruikt " + u + total)
        }
        if let v = Self.mb(memAppMB) { memParts.append("door Bingr (piek) " + v) }
        if lowMemory == true { memParts.append("weinig geheugen") }
        let mem = join(memParts)
        if !mem.isEmpty { L += ["", "Geheugen", "  " + mem] }
        if !fetch.isEmpty {
            L += ["", "Ophalen per server en soort"]
            for f in fetch {
                if let dt = Self.deliveredText(f) {
                    let kinds: [String: String] = ["live": "zenders", "movie": "films", "series": "series"]
                    L.append("  " + f.server + " " + (f.status == "ok" ? (kinds[f.kind] ?? f.kind) + ": " + dt : Self.fetchText(f) + " – " + dt))
                } else {
                    L.append("  " + f.server + " " + Self.fetchText(f))
                }
            }
        }
        var netParts: [String?] = []
        if let t = netType { netParts.append("verbinding " + Labels.netType(t)) }
        if let o = online { netParts.append(o ? "online" : "offline") }
        if let b = backend {
            let extra: String = backendMs.map { " (" + Self.ms($0) + ")" } ?? ""
            netParts.append("Bingr-server " + Labels.check(b).0 + extra)
        }
        if let p = provider {
            let extra: String = providerMs.map { " (" + Self.ms($0) + ")" } ?? ""
            netParts.append("IPTV-provider " + Labels.check(p).0 + extra)
        }
        if vpn == true { netParts.append("VPN aan") }
        let net = join(netParts)
        if !net.isEmpty { L += ["", "Netwerk", "  " + net] }
        var stoParts: [String?] = []
        if hasStorage2 {
            stoParts.append(Self.mb(totalMB).map { "totaal " + $0 })
            stoParts.append(Self.mb(cacheMB).map { "cache " + $0 })
            stoParts.append(Self.mb(catalogMB).map { "catalogus " + $0 })
            stoParts.append(Self.mb(downloadsMB).map { "downloads " + $0 })
            stoParts.append(Self.mb(storageFreeMB).map { "vrij op het apparaat " + $0 })
        } else {
            stoParts.append(Self.mb(storageUsedMB).map { "gebruikt " + $0 })
            stoParts.append(Self.mb(cacheMB).map { "cache " + $0 })
            stoParts.append(Self.mb(dbMB).map { "database " + $0 })
            stoParts.append(Self.mb(storageFreeMB).map { "vrij " + $0 })
        }
        let sto = join(stoParts)
        if !sto.isEmpty { L += ["", "Opslag", "  " + sto] }
        var stParts: [String?] = []
        if let v = signedIn { stParts.append("ingelogd " + (v ? "ja" : "nee")) }
        if let v = plan { stParts.append("abonnement " + (v == "lifetime" ? "Lifetime" : "Gratis")) }
        if let v = profiles { stParts.append("profielen " + Fmt.num(v)) }
        if let v = servers {
            let kinds: String = serverKinds.isEmpty ? "" : " (" + serverKinds.joined(separator: ", ") + ")"
            stParts.append("servers " + Fmt.num(v) + kinds)
        }
        if channels != nil || movies != nil || series != nil {
            let counts: [String] = [channels, movies, series].map { (v: Int?) -> String in v.map { Fmt.num($0) } ?? "–" }
            stParts.append("zenders/films/series " + counts.joined(separator: " / "))
        }
        if let v = lastSync { stParts.append("laatste sync " + Fmt.dateTime(v) + (lastSyncOk == false ? " (mislukt)" : "")) }
        if let v = pushEnabled { stParts.append("push " + (v ? "ja" : "nee")) }
        let st = join(stParts)
        if !st.isEmpty { L += ["", "App-status", "  " + st] }
        if hasCrash {
            L += ["", "Laatste crash"]
            let crashParts: [String?] = [crashAt.map { Fmt.dateTime($0) }, crashType, crashReason, crashBuild.map { "build \($0)" }]
            let c = join(crashParts)
            L.append("  " + (c.isEmpty ? "—" : c))
            L += crashStack.map { "    " + $0 }
        }
        return L.joined(separator: "\n")
    }

    var kindLabel: String { kind == "start" ? "Startdiagnose" : kind == "app" ? "App-diagnose" : kind }
    var appLine: String? {
        let p = platform.map(Labels.diagPlatform)
        let v = version.map { "Bingr \($0)" + (build.map { " (\($0))" } ?? "") }
        let s = [p, v].compactMap { $0 }.joined(separator: " · ")
        return s.isEmpty ? nil : s
    }
    var systemLine: String? { let s = [os, osVersion].compactMap { $0 }.joined(separator: " "); return s.isEmpty ? nil : s }
    /// Samenvatting voor de kop: soort, model, systeem, app.
    var summary: String {
        [kindLabel, model ?? deviceType.map(Labels.deviceType), systemLine, appLine].compactMap { $0 }.joined(separator: " · ")
    }
}

/// Antwoord van `support_inbox` (inbox-import van support@).
struct InboxStatus {
    struct LogItem: Identifiable {
        let id: Int
        let at: Date?
        let sender: String?
        let subject: String?
        let result: String
        let ticketNumber: Int?
        let detail: String?
    }

    let configured: Bool
    let user: String?
    let extraAgents: Bool
    let lastPollAt: Date?
    let lastOkAt: Date?
    let lastImportAt: Date?
    let lastError: String?
    let lastErrorAt: Date?
    let lastFetched: Int
    let more: Bool
    let log: [LogItem]

    init(_ j: JSON) {
        configured = j["configured"].bool ?? false
        user = j["user"].text
        extraAgents = j["extra_agents"].bool ?? false
        let s = j["state"]
        lastPollAt = s["last_poll_at"].date
        lastOkAt = s["last_ok_at"].date
        lastImportAt = s["last_import_at"].date
        lastError = s["last_error"].text
        lastErrorAt = s["last_error_at"].date
        lastFetched = s["last_result"]["fetched"].int ?? 0
        more = s["last_result"]["more"].bool ?? false
        log = j["log"].array.enumerated().map { i, x in
            LogItem(id: i, at: x["at"].date, sender: x["sender"].text, subject: x["subject"].text,
                    result: x["result"].text ?? "", ticketNumber: x["ticket_number"].int, detail: x["detail"].text)
        }
    }

    /// Laatste ronde mislukt (fout na de laatste geslaagde ronde).
    var failed: Bool {
        guard lastError != nil else { return false }
        guard let ok = lastOkAt else { return true }
        return (lastErrorAt ?? .distantPast) >= ok
    }

    /// Planning (elke 2 min) lijkt niet te lopen.
    var stale: Bool {
        guard let p = lastPollAt else { return true }
        return Date().timeIntervalSince(p) > 600
    }
}
