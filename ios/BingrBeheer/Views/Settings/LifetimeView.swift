import SwiftUI

/// Build 167 (server): Lifetime-only. Instellingen, kortingscodes en de mail "Bingr wordt Lifetime", zoals de tab
/// Lifetime-only van het web-dashboard (acties lifetime_settings, lifetime_codes_stats, lifetime_codes_generate, lifetime_mail).
/// Aanzetten, de overgang verzetten, de Apple-koopknop en de EU-link vragen een bevestiging (409 confirm_required).
struct LifetimeView: View {
    @Environment(Session.self) private var session
    @State private var settings: LifetimeSettings?
    @State private var original: LifetimeSettings?
    @State private var stats: LifetimeStats?
    @State private var unclaimed: (total: Int, items: [UnclaimedPurchase])?
    @State private var loadError: String?
    @State private var saving = false
    @State private var busy = false
    @State private var genText = ""
    @State private var mailText = ""
    @State private var testTo = ""
    @State private var testLang = "both"
    // bevestiging: tekst en de actie die daarna met confirm: true opnieuw gaat
    @State private var confirmMessage = ""
    @State private var confirmAction: (() async -> Void)?
    @State private var confirmShown = false

    var body: some View {
        Form {
            if let settings {
                stateSection(settings)
                settingsSection
                codesSection
                mailSection
                unclaimedSection
            } else if let loadError {
                Text(loadError).foregroundStyle(Color.warn)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Lifetime-only")
        .environment(\.timeZone, Fmt.amsterdam)
        .task { await load() }
        .refreshable { await load() }
        .alert("Weet je het zeker?", isPresented: $confirmShown) {
            Button("Doorgaan", role: .destructive) {
                let a = confirmAction
                Task { await a?() }
            }
            Button("Annuleren", role: .cancel) {}
        } message: {
            Text(confirmMessage)
        }
    }

    private func ask(_ keys: [String], extra: String = "", then action: @escaping () async -> Void) {
        confirmMessage = LifetimeSettings.confirmMessage(keys) + (extra.isEmpty ? "" : "\n\n" + extra)
        confirmAction = action
        confirmShown = true
    }

    @ViewBuilder private func stateSection(_ s: LifetimeSettings) -> some View {
        Section {
            LabeledContent("Stand", value: s.phase)
            if s.enabled {
                LabeledContent("Aankondiging", value: s.announceAt.map { Fmt.dateTimeNL($0) } ?? "meteen")
                LabeledContent("Overgang", value: Fmt.dateTimeNL(s.cutoverAt))
                LabeledContent("Korting", value: "\(s.discountPct)% t/m \(Fmt.dateTimeNL(s.codeValidUntil ?? s.cutoverAt))")
            }
            LabeledContent("Apple-koopknop", value: s.iapApple ? "aan" : "uit")
            LabeledContent("EU-link", value: s.appleEU ? "aan" : "uit")
        } header: {
            Text("Stand")
        } footer: {
            Text("Volgorde: instellingen invullen (nog uit laten), codes genereren (eerst droog), mail testen; op dag D Lifetime-only aan, mail versturen en de melding in de apps klaarzetten; 7 dagen voor de overgang de herinnering.")
        }
    }

    private func binding<T>(_ key: WritableKeyPath<LifetimeSettings, T>) -> Binding<T> {
        Binding(get: { settings![keyPath: key] }, set: { settings![keyPath: key] = $0 })
    }

    private func dateBinding(_ key: WritableKeyPath<LifetimeSettings, Date?>, fallback: Date) -> Binding<Date> {
        Binding(get: { settings![keyPath: key] ?? fallback }, set: { settings![keyPath: key] = $0 })
    }

    private func optionalDate(_ title: String, _ key: WritableKeyPath<LifetimeSettings, Date?>, fallback: Date, emptyText: String) -> some View {
        Group {
            Toggle(isOn: Binding(get: { settings?[keyPath: key] != nil }, set: { on in settings?[keyPath: key] = on ? fallback : nil })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                    if settings?[keyPath: key] == nil { Text(emptyText).font(.caption).foregroundStyle(Color.textDim) }
                }
            }
            .tint(.bingrRed)
            if settings?[keyPath: key] != nil {
                DatePicker(title, selection: dateBinding(key, fallback: fallback))
            }
        }
    }

    private var settingsSection: some View {
        let suggested = settings?.suggestedCutover ?? ISO8601DateFormatter().date(from: "2026-11-30T23:00:00Z") ?? Date()
        return Section {
            Toggle("Lifetime-only aan", isOn: binding(\.enabled)).tint(.bingrRed)
            optionalDate("Aankondiging vanaf", \.announceAt, fallback: Date(), emptyText: "Leeg = meteen bij aanzetten")
            optionalDate("Overgangsdatum", \.cutoverAt, fallback: suggested, emptyText: "Voorstel: \(Fmt.dateTimeNL(suggested))")
            Stepper("Korting: \(settings?.discountPct ?? 30)%", value: binding(\.discountPct), in: 1...90)
            optionalDate("Code geldig tot en met", \.codeValidUntil, fallback: settings?.suggestedCodeValidUntil ?? settings?.cutoverAt ?? suggested, emptyText: "Leeg = de overgangsdatum")
            Stepper("Proefperiode: \(settings?.trialDays ?? 0) dagen", value: binding(\.trialDays), in: 0...90)
            Toggle(isOn: binding(\.iapApple)) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Koopknop in de Apple-apps")
                    Text("Pas aanzetten als het product in App Store Connect klaarstaat en de server Apple-aankopen verwerkt.").font(.caption).foregroundStyle(Color.textDim)
                }
            }
            .tint(.bingrRed)
            Toggle(isOn: binding(\.appleEU)) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("EU-link (External Purchase Link)")
                    Text("Alleen aanzetten als Apple de entitlement heeft toegekend.").font(.caption).foregroundStyle(Color.textDim)
                }
            }
            .tint(.bingrRed)
            Button {
                Task { await save(confirm: false) }
            } label: {
                HStack {
                    if saving { ProgressView() }
                    Text("Opslaan")
                }
            }
            .disabled(saving || settings == original)
        } header: {
            Text("Instellingen")
        } footer: {
            Text("Zolang Lifetime-only uit staat, werkt alles zoals nu. Na de overgangsdatum zien gratis accounts alleen nog Activeer Lifetime. Tijden in Nederlandse tijd.")
        }
    }

    private var codesSection: some View {
        Section {
            if let s = stats {
                LabeledContent("Aangemaakt", value: Fmt.num(s.created) + (s.missing.map { $0 > 0 ? " (\(Fmt.num($0)) nog te maken)" : "" } ?? ""))
                LabeledContent("Gemaild", value: Fmt.num(s.mailed) + (s.reminded > 0 ? " (\(Fmt.num(s.reminded)) herinnerd)" : ""))
                LabeledContent("Mailfout", value: Fmt.num(s.mailError))
                LabeledContent("Gebruikt", value: Fmt.num(s.redeemed))
                LabeledContent("Verlopen", value: Fmt.num(s.expired))
                LabeledContent("Open", value: Fmt.num(s.open))
            }
            Button("Genereren (droog)") { Task { await generate(real: false) } }.disabled(busy)
            Button("Codes genereren") {
                ask(["generate"]) { await generate(real: true) }
            }
            .disabled(busy)
            if !genText.isEmpty { Text(genText).font(.footnote).foregroundStyle(Color.textDim) }
        } header: {
            Text("Kortingscodes")
        } footer: {
            Text("Eén persoonlijke code per gratis account, één keer te gebruiken en alleen door dat account. De server maakt ze aan in Stripe, in batches en zonder dubbele codes.")
        }
    }

    private var mailSection: some View {
        Section {
            TextField("Testmail naar (leeg = beheeradres)", text: $testTo)
                .textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
            Picker("Taal testmail", selection: $testLang) {
                Text("Nederlands en Engels").tag("both")
                Text("Nederlands").tag("nl")
                Text("Engels").tag("en")
            }
            Button("Aantallen (droog)") { Task { await mailDry() } }.disabled(busy)
            Button("Mail testen") { Task { await mailTest() } }.disabled(busy)
            Button("Mail versturen") { Task { await prepareSend("send") } }.disabled(busy)
            Button("Herinnering versturen") { Task { await prepareSend("remind") } }.disabled(busy)
            if !mailText.isEmpty { Text(mailText).font(.footnote).foregroundStyle(Color.textDim) }
        } header: {
            Text("Mail “Bingr wordt Lifetime”")
        } footer: {
            Text("Dienstmelding aan gratis accounts met een bevestigd e-mailadres, in de taal van het account, met de persoonlijke code. De herinnering gaat 7 dagen voor de overgang naar wie nog niet gekocht heeft. De melding in de apps zet je klaar als bericht (announcements).")
        }
    }

    private var unclaimedSection: some View {
        Section {
            if let u = unclaimed {
                LabeledContent("Niet geclaimd", value: Fmt.num(u.total))
                ForEach(u.items) { p in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.text).font(.subheadline)
                        if p.emailKnown { Text("e-mail bekend: wordt vanzelf gekoppeld bij inloggen").font(.caption).foregroundStyle(Color.textDim) }
                    }
                }
            } else {
                ProgressView()
            }
        } header: {
            Text("Niet geclaimde aankopen")
        } footer: {
            Text("Aankopen zonder account (eerst betalen, dan het account). Handmatig koppelen kan bij Gebruikers → account → Aankoop koppelen. Geen e-mailadressen.")
        }
    }

    // MARK: acties

    private func load() async {
        do {
            var s = LifetimeSettings(try await session.call("lifetime_settings"))
            original = s
            // aanvulling 2: lege datums krijgen het vaste voorstel (1 december 2026); pas bewaard na Opslaan
            if s.cutoverAt == nil, let c = s.suggestedCutover {
                s.cutoverAt = c
                if s.codeValidUntil == nil { s.codeValidUntil = s.suggestedCodeValidUntil ?? c }
            }
            settings = s; loadError = nil
        } catch {
            if (error as? APIError)?.code != "auth" { loadError = error.localizedDescription }
            return
        }
        stats = (try? await session.call("lifetime_codes_stats")).map(LifetimeStats.init)
        unclaimed = (try? await session.call("purchases_unclaimed")).map(UnclaimedPurchase.list)
    }

    private func save(confirm: Bool) async {
        guard let s = settings else { return }
        saving = true
        defer { saving = false }
        do {
            try await session.call("lifetime_settings", ["set": s.payload, "confirm": confirm ? true : nil])
            session.show("Lifetime-only opgeslagen. De apps nemen het binnen een paar minuten over.")
            await load()
        } catch let e as APIError where e.code == "confirm_required" {
            ask(e.body["confirm"].strings) { await save(confirm: true) }
        } catch {
            if (error as? APIError)?.code != "auth" { session.show(error.localizedDescription, bad: true) }
        }
    }

    private func generate(real: Bool) async {
        busy = true
        defer { busy = false }
        do {
            if !real {
                let r = try await session.call("lifetime_codes_generate", ["dry_run": true])
                genText = "Droog: \(Fmt.num(r["eligible"].int)) gratis accounts, \(Fmt.num(r["existing"].int)) hebben al een code, \(Fmt.num(r["to_create"].int)) codes zouden worden aangemaakt."
                return
            }
            var total = 0, failed = 0
            for _ in 0..<200 {
                let r = try await session.call("lifetime_codes_generate", ["dry_run": false, "confirm": true])
                total += r["created"].int ?? 0
                failed += r["failed"].int ?? 0
                let done = r["done"].bool ?? true
                genText = "Aangemaakt: \(Fmt.num(total))" + (failed > 0 ? ", mislukt: \(Fmt.num(failed))" : "") + (done ? "." : ", nog \(Fmt.num(r["remaining"].int)) te gaan…")
                if done || ((r["created"].int ?? 0) == 0 && (r["remaining"].int ?? 0) == 0) { break }
            }
            session.show("Codes aangemaakt.")
            stats = (try? await session.call("lifetime_codes_stats")).map(LifetimeStats.init)
        } catch {
            if (error as? APIError)?.code != "auth" { genText = error.localizedDescription }
        }
    }

    private func mailDry() async {
        busy = true
        defer { busy = false }
        do { mailText = "Droog: " + LifetimeMailResult(try await session.call("lifetime_mail", ["mode": "dry_run"])).recipientsText + "." }
        catch { if (error as? APIError)?.code != "auth" { mailText = error.localizedDescription } }
    }

    private func mailTest() async {
        busy = true
        defer { busy = false }
        let to = testTo.trimmingCharacters(in: .whitespaces)
        do {
            let r = LifetimeMailResult(try await session.call("lifetime_mail", ["mode": "test", "lang": testLang, "to": to.isEmpty ? nil : to]))
            mailText = "Testmail verstuurd (\(max(1, r.sent))×) naar \(to.isEmpty ? "het beheeradres" : "het opgegeven adres")."
        } catch { if (error as? APIError)?.code != "auth" { mailText = error.localizedDescription } }
    }

    private func prepareSend(_ mode: String) async {
        busy = true
        do {
            let d = LifetimeMailResult(try await session.call("lifetime_mail", ["mode": "dry_run"]))
            busy = false
            ask([mode], extra: "Nu: \(d.recipientsText).") { await send(mode) }
        } catch {
            busy = false
            if (error as? APIError)?.code != "auth" { mailText = error.localizedDescription }
        }
    }

    private func send(_ mode: String) async {
        busy = true
        defer { busy = false }
        var sent = 0, failed = 0
        do {
            for _ in 0..<500 {
                let r = LifetimeMailResult(try await session.call("lifetime_mail", ["mode": mode, "confirm": true]))
                sent += r.sent; failed += r.failed
                mailText = "Verstuurd: \(Fmt.num(sent))" + (failed > 0 ? ", mislukt: \(Fmt.num(failed))" : "") + (r.done ? "." : ", nog \(Fmt.num(r.remaining)) te gaan…")
                if r.done || (r.sent == 0 && r.remaining == 0) { break }
            }
            session.show(mode == "remind" ? "Herinnering verstuurd." : "Mail verstuurd.")
            stats = (try? await session.call("lifetime_codes_stats")).map(LifetimeStats.init)
        } catch {
            if (error as? APIError)?.code != "auth" { mailText = error.localizedDescription }
        }
    }
}
