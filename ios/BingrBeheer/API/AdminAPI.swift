import Foundation

/// Publieke Supabase-instellingen (dezelfde als web/config.js; de publishable key is bedoeld om openbaar te zijn).
enum Config {
    static let supabaseURL = URL(string: "https://vjewsncmsxmhmhnoxwqx.supabase.co")!
    static let publishableKey = "sb_publishable_lpIup6Omq5kW2k3oICGZ4g_HPGac5A3"
    static var adminFunction: URL { supabaseURL.appendingPathComponent("functions/v1/admin") }

    static let beheerSite = URL(string: "https://beheer.bingr.online/")!
    static let supportSite = URL(string: "https://support.bingr.online/")!
    static let statusPage = URL(string: "https://bingr.online/status/")!
}

/// Fout van de functie `admin`: `code` is het veld `error` uit het antwoord (of "network" / "server_error").
struct APIError: Error, LocalizedError {
    let code: String
    let status: Int
    let body: JSON

    var errorDescription: String? { APIError.text(code) }

    static func text(_ code: String) -> String {
        messages[code] ?? messages["server_error"]!
    }

    /// Zelfde teksten als ERR in web/admin.js.
    static let messages: [String: String] = [
        "network": "Geen verbinding met de server.",
        "server_error": "Er ging iets mis op de server.",
        "not_found": "Niet gevonden.",
        "auth": "Je sessie is verlopen. Log opnieuw in.",
        "too_soon": "Er is net al een reset-mail gestuurd. Probeer het over een minuut opnieuw.",
        "reset_failed": "De reset-mail kon niet worden verstuurd.",
        "smtp_not_configured": "E-mail is niet ingesteld op de server.",
        "text_missing": "Vul een Nederlandse titel en tekst in.",
        "bad_expires_at": "De verloopdatum moet in de toekomst liggen.",
        "status_not_configured": "De statusmonitor is nog niet ingesteld (Backend-workflow draaien).",
        "bad_url": "Vul een geldig http(s)-adres in (geen intern adres).",
        "bad_interval": "Kies een geldig interval.",
        "name_missing": "Vul een Nederlandse naam in.",
        "bad_group": "Kies een groep.",
        "builtin": "Een standaardmonitor kun je niet verwijderen; zet hem uit.",
        "forbidden": "De statusfunctie weigerde de aanvraag.",
        "support_not_configured": "Support is nog niet ingesteld (workflow Backend in iptv-ios-appletv draaien).",
        "support_not_deployed": "De functie support staat nog niet online (workflow Backend in iptv-ios-appletv draaien).",
        "support_forbidden": "De functie support weigerde de aanvraag (SUPPORT_ADMIN_SECRET klopt niet).",
        "message_missing": "Typ eerst een bericht.",
        "message_too_long": "Het bericht is te lang (max. 5000 tekens).",
        "too_many_links": "Het bericht bevat te veel links.",
        "bad_status": "Ongeldige status.",
        "bad_priority": "Ongeldige prioriteit.",
        "bad_number": "Ongeldig ticketnummer.",
        "invalid_credentials": "Onjuiste gebruikersnaam of wachtwoord.",
        "not_configured": "Beheer is nog niet ingesteld (BINGR_ADMIN_USER / BINGR_ADMIN_PASSWORD).",
        "bad_id": "Ongeldig account.",
        "reason_missing": "Vul een reden in (de klant ziet hem in de mail).",
        "bad_until": "Kies een einddatum in de toekomst (minstens 1 minuut, hoogstens 10 jaar), of onbepaald.",
        "block_failed": "Blokkeren is mislukt. Probeer het opnieuw.",
        "unblock_failed": "Opheffen is mislukt. Probeer het opnieuw.",
        "confirm_mismatch": "Het e-mailadres klopt niet. Typ het volledige adres of precies het adres zoals hierboven.",
        "delete_failed": "Verwijderen is mislukt; er is niets gemaild. Probeer het opnieuw.",
        "bad_plan": "Kies Gratis of Lifetime.",
        "bad_max_streams": "Tegelijk kijken: een heel getal van 1 tot 50, of leeg voor de standaard.",
        "bad_max_devices": "Apparaten: een heel getal van 1 tot 200, of leeg voor de standaard.",
        "bad_settings": "Ongeldige instellingen.",
        // build 97
        "invalid_token": "Ongeldige of verlopen link.",
        "unknown_action": "Onbekende actie (werk de app bij; de server is misschien nieuwer).",
        "rate_limited": "Te veel verzoeken achter elkaar. Wacht een minuut en probeer het opnieuw.",
        // meldingen (status: notice_save / notice_update / notice_delete), zelfde teksten als web/admin.js
        "title_missing": "Vul een Nederlandse titel in.",
        "notice_message_missing": "Schrijf een bericht (Nederlands) voor de tijdlijn.",
        "bad_window": "Kies een geldig tijdvak (einde na begin, max. 31 dagen).",
        "bad_component": "Onbekend onderdeel.",
        "bad_impact": "Ongeldige impact.",
        "bad_time": "Ongeldige begintijd.",
        "too_many_components": "Te veel onderdelen.",
        // downloads (builds / build_link), zelfde teksten als web/admin.js
        "bad_platform": "Onbekend platform.",
        "bad_file": "Ongeldige bestandsnaam.",
        "build_not_found": "Deze build staat niet (meer) op de server. Vernieuw de lijst.",
        "builds_not_configured": "Downloads nog niet ingericht: draai de workflow Builds.",
        "builds_unreachable": "De server met de builds is niet bereikbaar. Probeer het later opnieuw.",
        // naam van een account (user_set_name), zelfde teksten als web/admin.js
        "bad_name": "Ongeldige naam: gebruik geen regeleinden of tekens als < en >.",
        "name_too_long": "Een naam mag hoogstens 50 tekens zijn.",
        "name_failed": "De naam kon niet worden opgeslagen. Probeer het opnieuw.",
    ]
}

/// Praat met de Edge Function `admin`: POST JSON {action, token?, …} met header `apikey`.
/// Een native app stuurt geen Origin-header; de functie accepteert dat (CORS geldt alleen voor browsers).
struct AdminAPI {
    var session: URLSession = .shared

    func send(_ action: String, token: String?, params: [String: Any?] = [:]) async throws -> JSON {
        var payload: [String: Any] = ["action": action]
        if let token { payload["token"] = token }
        for (k, v) in params {
            if let v { payload[k] = v }
        }
        var req = URLRequest(url: Config.adminFunction, timeoutInterval: 75)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(Config.publishableKey, forHTTPHeaderField: "apikey")
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            if (error as? URLError)?.code == .cancelled || error is CancellationError { throw CancellationError() }
            throw APIError(code: "network", status: 0, body: .null)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let body = (try? JSONDecoder().decode(JSON.self, from: data)) ?? .null
        guard (200..<300).contains(status) else {
            throw APIError(code: body["error"].text ?? "server_error", status: status, body: body)
        }
        return body
    }
}
