import SwiftUI

/// Build 181: Bingr Premium, zoals de tab Premium van het web-dashboard: stand, overzicht (MRR, proeven, opzeggingen, Apple
/// en Stripe apart), de schakelaars met uitleg, Stripe-producten aanmaken (droog en echt), testaccounts en de concept-mailing.
/// Acties premium_settings, premium_stats, premium_setup, premium_test en premium_mailing. Aanzetten, datums, prijzen op de
/// site, prijzen en het echt aanmaken in Stripe vragen een bevestiging (409 confirm_required).
struct PremiumView: View {
    @Environment(Session.self) private var session
    @State private var state: PremiumState?
    @State private var settings: PremiumSettings?
    @State private var stats: PremiumStats?
    @State private var mailing: PremiumMailing?
    @State private var loadError: String?
    @State private var saving = false
    @State private var setupBusy = false
    @State private var setupText = ""
    @State private var openMailing = false
    @State private var confirmMessage = ""
    @State private var confirmAction: (() async -> Void)?
    @State private var confirmShown = false

    var body: some View {
        Form {
            if let state, settings != nil {
                stateSection(state)
                statsSection
                switchesSection
                pricesSection
                setupSection
                testSection(state.settings.testUsers)
                mailingSection
            } else if let loadError {
                Text(loadError).foregroundStyle(Color.warn)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Premium")
        .environment(\.timeZone, Fmt.amsterdam)
        .task { await load() }
        .refreshable { await load() }
        .navigationDestination(isPresented: $openMailing) { MailingView() }
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

    private func ask(_ keys: [String], warnings: [String], then action: @escaping () async -> Void) {
        let w: String = PremiumSettings.warningMessage(warnings)
        confirmMessage = PremiumSettings.confirmMessage(keys) + (w.isEmpty ? "" : "\n\n" + w)
        confirmAction = action
        confirmShown = true
    }

    // MARK: stand

    @ViewBuilder private func stateSection(_ s: PremiumState) -> some View {
        let chip = s.chip
        Section {
            HStack {
                Text("Stand")
                Spacer()
                Chip(text: chip.0, tone: chip.1)
            }
            LabeledContent("Web en Android", value: s.when(s.settings.newFromWeb))
            LabeledContent("Apple-apps", value: s.when(s.settings.newFromApple))
            LabeledContent("Bestaande gratis accounts", value: s.settings.existingFrom.map { Fmt.dateTimeNL($0) } ?? "—")
            LabeledContent("Proef", value: s.trialText)
            LabeledContent("Prijzen op de site", value: s.settings.showPricesWeb ? "aan" : "uit")
            LabeledContent("Stripe", value: s.mode ?? "onbekend")
            if s.testCount > 0 { LabeledContent("Testaccounts", value: Fmt.num(s.testCount)) }
            if !s.warnings.isEmpty {
                Label(PremiumSettings.warningMessage(s.warnings), systemImage: "exclamationmark.triangle")
                    .font(.footnote).foregroundStyle(Color.warn)
            }
        } header: {
            Text("Stand")
        } footer: {
            Text("Volgorde: 1. Stripe-producten aanmaken (eerst droog, met de live-sleutel opnieuw). 2. Test met je eigen (gratis) testaccount. 3. Prijzen tonen op bingr.online. 4. Hoofdschakelaar aan en de datum voor web en Android. 5. Na de goedkeuring van Apple: de datum voor de Apple-apps. 6. Bestaande gratis accounts: standaard 1 december 2026 00:01.")
        }
    }

    // MARK: overzicht

    private func statRow(_ label: String, _ value: String, _ hint: String = "") -> some View {
        LabeledContent {
            VStack(alignment: .trailing, spacing: 2) {
                Text(value).monospacedDigit()
                if !hint.isEmpty { Text(hint).font(.caption).foregroundStyle(Color.textDim).multilineTextAlignment(.trailing) }
            }
        } label: {
            Text(label)
        }
    }

    private var statsSection: some View {
        Section {
            if let s = stats {
                statRows(s)
                ForEach(s.by) { r in
                    LabeledContent(r.title) { Text(r.detail).font(.caption).multilineTextAlignment(.trailing) }
                }
                if !s.monthly.isEmpty {
                    Text("Stripe-abonnementen per maand: " + s.monthly.joined(separator: " · ") + ". Apple-abonnementen staan bij Omzet (App Store Connect).")
                        .font(.caption).foregroundStyle(Color.textDim)
                }
            } else {
                ProgressView()
            }
        } header: {
            Text("Overzicht")
        } footer: {
            Text("MRR: maand ×1, halfjaar ÷6, jaar ÷12. Alleen totalen, geen gegevens per persoon.")
        }
    }

    @ViewBuilder private func statRows(_ s: PremiumStats) -> some View {
        let pastDue: String = s.pastDue > 0 ? Fmt.num(s.pastDue) + " betaling mislukt" : ""
        let conv: String = s.conversionText
        let trialHint: String = Fmt.num(s.trialsStarted) + " proeven gestart" + (conv.isEmpty ? "" : " · " + conv)
        let refunded: String = s.liveRefunded > 0 ? " · " + Fmt.euro(s.liveRefunded) + " terug" : ""
        let ap = s.provider("apple")
        let sp = s.provider("stripe")
        statRow("Actief (betaald)", Fmt.num(s.active), pastDue)
        statRow("In proef", Fmt.num(s.trialing), trialHint)
        statRow("Opgezegd", Fmt.num(s.canceled), "nog actief tot het einde van de periode · " + Fmt.num(s.expired30d) + " verlopen (30 d)")
        statRow("MRR", Fmt.euro(s.mrr))
        statRow("Stripe", Fmt.num(sp.active) + " actief", Fmt.num(sp.trialing) + " in proef · " + Fmt.euro(sp.mrr) + " MRR")
        statRow("Apple", Fmt.num(ap.active) + " actief", Fmt.num(ap.trialing) + " in proef · " + Fmt.euro(ap.mrr) + " MRR")
        statRow("Lifetime € 49,99", Fmt.num(s.lifetimeCount), Fmt.euro(s.lifetimeGross))
        statRow("Stripe-omzet (live)", Fmt.euro(s.liveGross), Fmt.num(s.liveCount) + " betalingen" + refunded)
        if s.unclaimed > 0 { statRow("Niet gekoppeld", Fmt.num(s.unclaimed), "gast-abonnementen zonder account") }
    }

    // MARK: schakelaars

    private func binding<T>(_ key: WritableKeyPath<PremiumSettings, T>) -> Binding<T> {
        Binding(get: { settings![keyPath: key] }, set: { settings![keyPath: key] = $0 })
    }

    private func optionalDate(_ title: String, _ key: WritableKeyPath<PremiumSettings, Date?>, hint: String, now: Bool) -> some View {
        let isOn = Binding<Bool>(get: { settings?[keyPath: key] != nil }, set: { on in settings?[keyPath: key] = on ? Self.defaultDate(now: now) : nil })
        let date = Binding<Date>(get: { settings?[keyPath: key] ?? Date() }, set: { settings?[keyPath: key] = $0 })
        return Group {
            Toggle(isOn: isOn) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                    Text(hint).font(.caption).foregroundStyle(Color.textDim)
                }
            }
            .tint(.bingrRed)
            if settings?[keyPath: key] != nil {
                DatePicker(title, selection: date)
                if now {
                    Button("Nu") { settings?[keyPath: key] = Date().addingTimeInterval(60) }
                }
            }
        }
    }

    /// Nieuwe datum: "nu" (+1 minuut) voor de groepen, voor bestaande accounts het voorstel 1 december 2026 00:01.
    private static func defaultDate(now: Bool) -> Date {
        if now { return Date().addingTimeInterval(60) }
        return ISO8601DateFormatter().date(from: "2026-11-30T23:01:00Z") ?? Date()
    }

    private var switchesSection: some View {
        Section {
            Toggle(isOn: binding(\.enabled)) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Premium aan (hoofdschakelaar)")
                    Text("Zonder deze schakelaar doen de datums hieronder niets.").font(.caption).foregroundStyle(Color.textDim)
                }
            }
            .tint(.bingrRed)
            Toggle(isOn: binding(\.showPricesWeb)) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Prijzen tonen op bingr.online")
                    Text("Het nieuwe prijsblok op de homepage en de plannen op /upgrade/. Kan al aan vóór de apps meedoen; eerst “Stripe-producten aanmaken”.").font(.caption).foregroundStyle(Color.textDim)
                }
            }
            .tint(.bingrRed)
            optionalDate("Nieuwe accounts web en Android vanaf", \.newFromWeb, hint: "Website, webspeler, Windows, Android en Android TV. Nieuwe accounts kiezen een plan, met proef. Uit = leeg.", now: true)
            optionalDate("Nieuwe accounts Apple-apps vanaf", \.newFromApple, hint: "iPhone, iPad, Mac en Apple TV. Pas na de goedkeuring van build 181 en de producten in App Store Connect.", now: true)
            optionalDate("Bestaande gratis accounts vanaf", \.existingFrom, hint: "Daarna moeten ook bestaande gratis accounts kiezen, zonder proef. Geldt alleen in een groep die meedoet.", now: false)
            Stepper(value: binding(\.trialDays), in: 0...14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Proef voor nieuwe accounts: \(settings?.trialDays ?? 0) dagen")
                    Text("Eén keer per account, alleen op een abonnement. 0 = geen proef.").font(.caption).foregroundStyle(Color.textDim)
                }
            }
            Stepper(value: binding(\.graceDays), in: 0...16) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Respijt na een mislukte betaling: \(settings?.graceDays ?? 0) dagen")
                    Text("Zo lang blijft Premium aan na een mislukte verlenging (Stripe). Apple gebruikt zijn eigen respijt.").font(.caption).foregroundStyle(Color.textDim)
                }
            }
            saveButton
        } header: {
            Text("Schakelaars")
        } footer: {
            Text("Alles staat standaard uit: dan werkt Bingr precies zoals nu. Zet het stap voor stap aan, eerst voor jezelf (Test met mijn account), dan web en Android, en pas na de goedkeuring van Apple de Apple-apps. Tijden zijn Nederlandse tijd. Bestaande Lifetime-accounts merken nooit iets.")
        }
    }

    private var saveButton: some View {
        let unchanged: Bool = settings == state?.settings
        return Button {
            Task { await save(confirm: false) }
        } label: {
            HStack {
                if saving { ProgressView() }
                Text("Opslaan")
            }
        }
        .disabled(saving || unchanged)
    }

    // MARK: prijzen

    private func priceBinding(_ plan: String) -> Binding<Int> {
        Binding(get: { settings?.price(plan) ?? 0 }, set: { settings?.prices[plan] = $0 })
    }

    private func priceRow(_ plan: String) -> some View {
        let label: String = PremiumSettings.priceLabels[plan] ?? plan
        let euro: String = Fmt.euro(settings?.price(plan))
        return LabeledContent {
            HStack(spacing: 8) {
                TextField(label, value: priceBinding(plan), format: .number)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 90)
                Text(euro).font(.caption).foregroundStyle(Color.textDim).frame(minWidth: 64, alignment: .trailing)
            }
        } label: {
            Text(label)
        }
    }

    private var pricesSection: some View {
        Section {
            ForEach(PremiumSettings.plans, id: \.self) { p in priceRow(p) }
            saveButton
        } header: {
            Text("Prijzen (centen, incl. btw)")
        } footer: {
            Text("Een andere prijs maakt bij “Stripe-producten aanmaken” een nieuwe Stripe-prijs; lopende abonnementen houden hun prijs. In de Apple-apps geldt de prijs uit App Store Connect. Lifetime moet hoger zijn dan Jaarlijks.")
        }
    }

    // MARK: Stripe-producten

    private var setupSection: some View {
        Section {
            Button("Controleren (droog)") { Task { await setup(dry: true, confirm: false) } }.disabled(setupBusy)
            Button("Stripe-producten aanmaken") { Task { await setup(dry: false, confirm: false) } }.disabled(setupBusy)
            if setupBusy { ProgressView() }
            if !setupText.isEmpty { Text(setupText).font(.footnote).foregroundStyle(Color.textDim) }
        } header: {
            Text("Stripe-producten")
        } footer: {
            Text("Maakt in de Stripe-modus van de server (test of live) de producten Bingr Premium en Bingr Premium Lifetime aan, de vier prijzen en de Customer Portal (opzeggen, betaalmethode, facturen), en bewaart de id's. Herhaalbaar: wat er al is, blijft. Na de overstap naar live opnieuw doen.")
        }
    }

    // MARK: testaccounts

    private func testSection(_ ids: [String]) -> some View {
        Section {
            if ids.isEmpty {
                Text("Geen testaccounts.").foregroundStyle(Color.textDim)
            }
            ForEach(ids, id: \.self) { id in
                HStack {
                    Text(id).font(.caption.monospaced()).lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                    Spacer()
                    Button("Uit") { Task { await testOff(id) } }.buttonStyle(.borderless)
                }
            }
        } header: {
            Text("Test met mijn account")
        } footer: {
            Text("Een testaccount ziet Premium al, ook met alles uit: alsof het nieuw is (proef mag) op alle apparaten. Zet het aan bij Gebruikers, in de details van een account (Premium testen). Een Lifetime-account blijft volledig toegang houden; test daarom met een gratis account.")
        }
    }

    // MARK: concept-mailing

    private func mailText(_ l: PremiumMailing.Lang, url: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(l.body).font(.caption).textSelection(.enabled)
            Text("Knop: " + l.button + " → " + url).font(.caption).foregroundStyle(Color.textDim)
        }
    }

    private var mailingSection: some View {
        Section {
            if let m = mailing {
                DisclosureGroup("Nederlands: " + m.nl.subject) { mailText(m.nl, url: m.url) }
                DisclosureGroup("Engels: " + m.en.subject) { mailText(m.en, url: m.url) }
                Button("In Eigen mailing zetten") {
                    m.saveAsDraft()
                    session.show("Concept staat in Eigen mailing. Er is niets verstuurd.")
                    openMailing = true
                }
            } else {
                ProgressView()
            }
        } header: {
            Text("Concept-mailing voor bestaande gratis accounts")
        } footer: {
            Text("Wordt niet verstuurd. “In Eigen mailing zetten” vult het formulier van Eigen mailing (Servicebericht); controleer en verstuur het daar zelf als het zover is.")
        }
    }

    // MARK: acties

    private func load() async {
        do {
            let s = PremiumState(try await session.call("premium_settings"))
            state = s
            settings = s.settings
            loadError = nil
        } catch {
            if (error as? APIError)?.code != "auth" { loadError = error.localizedDescription }
            return
        }
        stats = (try? await session.call("premium_stats")).map(PremiumStats.init)
        mailing = (try? await session.call("premium_mailing")).map(PremiumMailing.init)
    }

    private func save(confirm: Bool) async {
        guard let s = settings else { return }
        saving = true
        defer { saving = false }
        do {
            try await session.call("premium_settings", ["set": s.payload, "confirm": confirm ? true : nil])
            session.show("Premium opgeslagen. De apps nemen het binnen een paar minuten over.")
            await load()
        } catch let e as APIError where e.code == "confirm_required" {
            ask(e.body["confirm"].strings, warnings: e.body["warnings"].strings) { await save(confirm: true) }
        } catch {
            if (error as? APIError)?.code != "auth" { session.show(error.localizedDescription, bad: true) }
        }
    }

    private func setup(dry: Bool, confirm: Bool) async {
        setupBusy = true
        setupText = ""
        defer { setupBusy = false }
        do {
            let r = try await session.call("premium_setup", ["dry_run": dry, "confirm": confirm ? true : nil])
            setupText = PremiumSetupResult(r).text
            if !dry { await load() }
        } catch let e as APIError where e.code == "confirm_required" {
            ask(e.body["confirm"].strings, warnings: []) { await setup(dry: false, confirm: true) }
        } catch {
            if (error as? APIError)?.code != "auth" { setupText = error.localizedDescription }
        }
    }

    private func testOff(_ id: String) async {
        do {
            try await session.call("premium_test", ["user_id": id, "on": false])
            session.show("Premium-test staat uit voor dit account.")
            await load()
        } catch {
            if (error as? APIError)?.code != "auth" { session.show(error.localizedDescription, bad: true) }
        }
    }
}
