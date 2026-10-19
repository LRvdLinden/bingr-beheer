import SwiftUI

/// Eigen mailing (zoals het blok "Eigen mailing" in de tab Nieuwsbrief van web/admin.js): zelf een mail opstellen in NL en
/// EN, doelgroep kiezen (nieuwsbrief-abonnees of servicebericht aan alle gebruikers), voorbeeld bekijken, testmail naar één
/// adres (nooit bewaard of gelogd), versturen met bevestiging, voortgang met annuleren en de verstuurde mailings.
/// Acties mailing_status, mailing_render, mailing_test, mailing_send en mailing_cancel (functie admin → newsletter).
struct MailingView: View {
    @Environment(Session.self) private var session

    @State private var status: MailingStatus?
    @State private var loadError: String?
    @State private var draft = MailingDraft.load()
    @State private var ack = false
    @State private var error = ""

    @State private var testTo = ""
    @State private var testLang = "nl"
    @State private var testing = false
    @State private var testError = ""

    @State private var rendering: String?
    @State private var rendered: RenderedMail?
    @State private var confirmSend = false
    @State private var sending = false
    @State private var confirmCancel = false

    private var audience: MailingAudience { MailingAudience(rawValue: draft.audience) ?? .newsletter }

    var body: some View {
        Form {
            if let loadError { Section { Text(loadError).foregroundStyle(Color.warn) } }
            if let a = status?.active { activeSection(a) }
            audienceSection
            Section {
                TextField("Onderwerp", text: $draft.subjectNl)
                TextField("Tekst", text: $draft.bodyNl, axis: .vertical).lineLimit(6...24)
                TextField("Knoptekst (alleen met een knop-URL)", text: $draft.buttonNl)
            } header: { Text("Nederlands") }
            Section {
                TextField("Subject", text: $draft.subjectEn)
                TextField("Text", text: $draft.bodyEn, axis: .vertical).lineLimit(6...24)
                TextField("Button text (alleen met een knop-URL)", text: $draft.buttonEn)
            } header: { Text("Engels") }
            Section {
                urlField("Afbeelding-URL (optioneel, https)", text: $draft.image)
                urlField("Knop-URL (optioneel, https)", text: $draft.buttonURL)
            } footer: {
                Text("Opmaak: lege regel = nieuwe alinea · # Kop · ## Kleinere kop · **vet** · [linktekst](https://…) · - punt of 1. punt voor een opsomming. Geen HTML; links en afbeeldingen alleen met https. Heeft een lid een voornaam, dan begint de mail met Hoi …, / Hi ….")
            }
            Section {
                HStack {
                    previewButton("Voorbeeld NL", lang: "nl")
                    previewButton("Voorbeeld EN", lang: "en")
                }
                if !error.isEmpty { Text(error).font(.subheadline).foregroundStyle(Color.warn) }
            } header: { Text("Voorbeeld") }
            testSection
            sendSection
            historySection
        }
        .scrollContentBackground(.hidden)
        .screenBackground()
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Eigen mailing")
        .navigationBarTitleDisplayMode(.inline)
        .refreshableCommand { await load() }
        .task { await load() }
        .task(id: status?.active?.id ?? 0) {
            // voortgang bijwerken zolang er een mailing loopt
            guard status?.active != nil else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                if Task.isCancelled { return }
                await load()
                if status?.active == nil { return }
            }
        }
        .onChange(of: draft) { _, d in d.save() }
        .alert("Mailing versturen?", isPresented: $confirmSend) {
            Button("Annuleren", role: .cancel) {}
            Button("Versturen", role: audience == .service ? .destructive : nil) { Task { await send() } }
        } message: {
            Text(confirmText)
        }
        .alert("Mailing annuleren?", isPresented: $confirmCancel) {
            Button("Terug", role: .cancel) {}
            Button("Annuleren", role: .destructive) { Task { await cancel() } }
        } message: {
            Text("Wie nog niets kreeg (\(Fmt.num(status?.active?.left))), krijgt hem niet meer. Wat al verstuurd is, blijft verstuurd.")
        }
        .sheet(item: $rendered) { mail in
            NavigationStack {
                MailPreview(html: mail.html)
                    .ignoresSafeArea(edges: .bottom)
                    .navigationTitle(mail.subject.isEmpty ? "Voorbeeld" : mail.subject)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) { Button("Klaar") { rendered = nil } }
                    }
            }
        }
    }

    // MARK: onderdelen

    private func activeSection(_ a: MailingItem) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Chip(text: "Bezig met versturen", tone: .warn)
                    Chip(text: a.audience.short, tone: a.audience == .service ? .warn : .neutral)
                }
                Text(a.subjectNl.isEmpty ? "—" : a.subjectNl).font(.headline)
                if !a.subjectEn.isEmpty { Text(a.subjectEn).font(.caption).foregroundStyle(Color.textDim) }
                ProgressView(value: a.progress).tint(.bingrRed)
                Text("\(Fmt.num(a.sent)) verstuurd · \(Fmt.num(a.failed)) mislukt · \(Fmt.num(a.skipped)) overgeslagen · \(Fmt.num(a.left)) te gaan van \(Fmt.num(a.recipients.total)) (\(Fmt.num(a.recipients.nl)) NL, \(Fmt.num(a.recipients.en)) EN)")
                    .font(.caption).foregroundStyle(Color.textSecondary)
                if a.left > 0, let s = status {
                    Text("Nog \(s.duration(a.left)) (max. \(Fmt.num(s.perHour)) per uur) · gestart \(Fmt.dateTime(a.createdAt))")
                        .font(.caption2).foregroundStyle(Color.textDim)
                }
            }
            .accessibilityElement(children: .combine)
            Button("Annuleren", role: .destructive) { confirmCancel = true }
        } header: { Text("Bezig") }
    }

    private var audienceSection: some View {
        Section {
            ForEach(MailingAudience.allCases) { a in
                Button {
                    draft.audience = a.rawValue
                    if a == .newsletter { ack = false }
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: audience == a ? "largecircle.fill.circle" : "circle")
                            .foregroundStyle(audience == a ? Color.bingrRed : Color.textDim)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(a.title + (status.map { " (\(Fmt.num($0.counts(a).total)))" } ?? ""))
                                .font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                            Text(a.help).font(.caption).foregroundStyle(Color.textDim)
                        }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(audience == a ? .isSelected : [])
            }
            if audience == .service {
                Text(MailingAudience.serviceWarning).font(.caption).foregroundStyle(Color.warn)
                Toggle("Dit bericht bevat alleen belangrijke service-informatie en geen reclame", isOn: $ack).tint(.bingrRed)
            }
        } header: { Text("Doelgroep") }
    }

    private var testSection: some View {
        Section {
            TextField("E-mailadres", text: $testTo)
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onChange(of: testTo) { _, v in if v.count > 254 { testTo = String(v.prefix(254)) } }
            Picker("Taal", selection: $testLang) {
                Text("NL").tag("nl")
                Text("EN").tag("en")
                Text("Beide").tag("both")
            }
            .pickerStyle(.segmented)
            if !testError.isEmpty { Text(testError).font(.subheadline).foregroundStyle(Color.warn) }
            Button {
                Task { await sendTest() }
            } label: {
                HStack {
                    if testing { ProgressView() }
                    Text("Testmail sturen")
                }
            }
            .disabled(testing)
        } header: {
            Text("Testmail")
        } footer: {
            Text("Stuurt de mail met [Test] in het onderwerp alleen naar dit adres. Het adres wordt niet bewaard en niet gelogd. Telt mee voor dezelfde limiet als de voorbeelden (samen 10 per uur).")
        }
    }

    private var sendSection: some View {
        Section {
            Button {
                error = ""
                if let bad = draft.check(["nl", "en"]) { error = APIError.text(bad); return }
                if audience == .service && !ack { error = APIError.text("service_ack_required"); return }
                if (status?.counts(audience).total ?? 0) == 0 { error = APIError.text("no_recipients"); return }
                confirmSend = true
            } label: {
                HStack {
                    if sending { ProgressView().tint(.white) }
                    Text("Versturen…")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bingr)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            .disabled(sending || status == nil || status?.active != nil || (audience == .service && !ack))
        } footer: {
            Text(sendFooter)
        }
    }

    private var historySection: some View {
        Section {
            if let s = status {
                if s.mailings.isEmpty { EmptyText(text: "Nog geen eigen mailings verstuurd.") }
                ForEach(s.mailings) { m in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Chip(text: m.audience.short.uppercased(), tone: m.audience == .service ? .warn : .neutral)
                            Chip(text: m.statusText, tone: m.statusTone)
                            Spacer(minLength: 0)
                            Text(Fmt.dateTime(m.createdAt)).font(.caption2).foregroundStyle(Color.textDim)
                        }
                        Text(m.subjectNl.isEmpty ? "—" : m.subjectNl).font(.subheadline.weight(.bold))
                        if !m.subjectEn.isEmpty { Text("EN: \(m.subjectEn)").font(.caption).foregroundStyle(Color.textDim) }
                        Text("\(Fmt.num(m.recipients.total)) ontvangers · \(Fmt.num(m.sent)) verstuurd · \(Fmt.num(m.failed)) mislukt · \(Fmt.num(m.skipped)) overgeslagen" + (m.cancelled > 0 ? " · \(Fmt.num(m.cancelled)) niet verstuurd" : ""))
                            .font(.caption).foregroundStyle(Color.textSecondary)
                    }
                    .accessibilityElement(children: .combine)
                }
            } else if loadError == nil {
                ProgressView()
            }
        } header: {
            Text("Verstuurde mailings")
        } footer: {
            Text("Alleen onderwerpen en aantallen, nooit adressen. Verstuurd = aangenomen door de mailserver; overgeslagen = intussen afgemeld, geblokkeerd of verwijderd.")
        }
    }

    private func urlField(_ title: String, text: Binding<String>) -> some View {
        TextField(title, text: text)
            .keyboardType(.URL)
            .textContentType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
    }

    private func previewButton(_ title: String, lang: String) -> some View {
        Button {
            Task { await render(lang) }
        } label: {
            HStack {
                if rendering == lang { ProgressView() }
                Text(title)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bingrGhost)
        .disabled(rendering != nil)
    }

    private var sendFooter: String {
        guard let s = status else { return "" }
        if s.active != nil { return "Er wordt al een mailing verstuurd; een nieuwe kan pas als die klaar of geannuleerd is." }
        let n = s.counts(audience)
        return "\(Fmt.plural(n.total, "ontvanger", "ontvangers")) (\(Fmt.num(n.nl)) NL, \(Fmt.num(n.en)) EN) · verzending in rondes van elke 5 minuten, max. \(Fmt.num(s.perHour)) per uur (\(s.duration(n.total))). Elke ontvanger krijgt de versie in de taal van zijn account."
    }

    private var confirmText: String {
        guard let s = status else { return "" }
        let n = s.counts(audience)
        let who = audience == .service
            ? "SERVICEBERICHT aan alle \(Fmt.num(n.total)) leden met een bevestigd e-mailadres, ook wie zich heeft afgemeld (geen afmeldlink). Alleen voor belangrijke service-informatie, nooit reclame."
            : "Nieuwsbrief-abonnees: \(Fmt.plural(n.total, "ontvanger", "ontvangers"))."
        let nl = draft.subjectNl.trimmingCharacters(in: .whitespacesAndNewlines)
        let en = draft.subjectEn.trimmingCharacters(in: .whitespacesAndNewlines)
        return "\(who)\n\n\(Fmt.num(n.nl)) krijgen de Nederlandse versie (\"\(nl)\")\n\(Fmt.num(n.en)) krijgen de Engelse versie (\"\(en)\")\n\nVerzending in rondes van elke 5 minuten, max. \(Fmt.num(s.perHour)) per uur (\(s.duration(n.total))). Annuleren kan zolang hij niet klaar is."
    }

    // MARK: acties

    private func load() async {
        do {
            let r = try await session.call("mailing_status")
            status = MailingStatus(r)
            loadError = nil
        } catch let e as APIError {
            if e.code == "auth" { return }
            loadError = e.errorDescription
        } catch {}
    }

    private func render(_ lang: String) async {
        error = ""
        if let bad = draft.check([lang]) { error = APIError.text(bad); return }
        rendering = lang
        defer { rendering = nil }
        do {
            let r = try await session.call("mailing_render", ["content": draft.content, "audience": audience.rawValue, "lang": lang])
            guard let html = r["html"].string, !html.isEmpty else { error = APIError.text("server_error"); return }
            rendered = RenderedMail(subject: r["subject"].string ?? "", html: html)
        } catch let e as APIError {
            if e.code != "auth" { error = e.errorDescription ?? "" }
        } catch {}
    }

    private func sendTest() async {
        testError = ""
        let address = testTo.trimmingCharacters(in: .whitespacesAndNewlines)
        guard EmailCheck.looksValid(address) else { testError = APIError.text("bad_email"); return }
        if let bad = draft.check(testLang == "both" ? ["nl", "en"] : [testLang]) { testError = APIError.text(bad); return }
        testing = true
        defer { testing = false }
        do {
            _ = try await session.call("mailing_test", ["to": address, "content": draft.content, "audience": audience.rawValue, "lang": testLang])
            session.show(testLang == "both" ? "Twee testmails (NL en EN) verstuurd." : "Testmail (\(testLang.uppercased())) verstuurd.")
        } catch let e as APIError {
            if e.code != "auth" { testError = e.errorDescription ?? "" }
        } catch {}
    }

    private func send() async {
        error = ""
        sending = true
        defer { sending = false }
        let params: [String: Any?] = [
            "request_id": UUID().uuidString.lowercased(), "content": draft.content, "audience": audience.rawValue,
            "service_ack": audience == .service && ack,
        ]
        do {
            let r: JSON
            do {
                r = try await session.call("mailing_send", params)
            } catch let e as APIError where e.code == "network" {
                // één keer opnieuw met dezelfde request_id: de functie maakt dan geen tweede mailing
                r = try await session.call("mailing_send", params)
            }
            session.show("Mailing gestart: \(Fmt.plural(r["recipients"]["total"].int ?? 0, "ontvanger", "ontvangers")).")
            ack = false
        } catch let e as APIError {
            if e.code != "auth" { error = e.errorDescription ?? "" }
        } catch {}
        await load()
    }

    private func cancel() async {
        guard let a = status?.active else { return }
        do {
            let r = try await session.call("mailing_cancel", ["id": a.id])
            session.show("Mailing geannuleerd (\(Fmt.num(r["cancelled"].int ?? 0)) niet verstuurd).")
        } catch {
            session.report(error)
        }
        await load()
    }
}
