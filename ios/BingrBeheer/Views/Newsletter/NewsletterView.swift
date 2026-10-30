import SwiftUI
import WebKit

/// Onderdeel Nieuwsbrief (zoals de tab in web/admin.js): schakelaar aan/uit (bevestiging bij aanzetten met het aantal
/// leden), volgende verzending (NL-tijd), ontvangers NL/EN, voorbeeld sturen naar één adres (nooit bewaard of gelogd),
/// voorbeeld bekijken en de geschiedenis van edities. Secties Top 10 deze week en Populair aan/uit
/// (newsletter_set_sections). Acties newsletter_status, newsletter_set_enabled,
/// newsletter_preview en newsletter_render (functie admin → newsletter). Blok Welkomstmail: aantallen uit
/// newsletter_status.welcome, voorbeeld sturen (welcome_preview) en bekijken (welcome_render). Blok Eigen mailing: link naar
/// MailingView (zelf een mail opstellen en versturen, acties mailing_*). Blok Maandoverzicht ("Volgende maand op Bingr"):
/// schakelaar (newsletter_set_sections monthly), volgende verzending, testmail (monthly_preview), voorbeeld (monthly_render)
/// en de geschiedenis van maandedities (newsletter_status.monthly).
struct NewsletterView: View {
    @Environment(Session.self) private var session

    @State private var status: NewsletterStatus?
    @State private var loadError: String?
    @State private var loaded = false
    @State private var switching = false
    @State private var confirmOn = false

    @State private var to = ""
    @State private var sendLang = "nl"
    @State private var sending = false
    @State private var sendError = ""

    @State private var viewLang = "nl"
    @State private var rendering = false
    @State private var rendered: RenderedMail?

    @State private var wTo = ""
    @State private var wSendLang = "nl"
    @State private var wSending = false
    @State private var wSendError = ""
    @State private var wViewLang = "nl"
    @State private var wRendering = false

    @State private var mTo = ""
    @State private var mSendLang = "nl"
    @State private var mSending = false
    @State private var mSendError = ""
    @State private var mViewLang = "nl"
    @State private var mRendering = false
    @State private var confirmMonthlyOff = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let loadError { NoticeBanner(text: loadError) }
                statusCard
                mailingCard
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 12) {
                        sendCard
                        viewCard
                    }
                    .frame(minWidth: 760)
                    VStack(spacing: 12) {
                        sendCard
                        viewCard
                    }
                }
                monthlyCard
                welcomeCard
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 12) {
                        welcomeSendCard
                        welcomeViewCard
                    }
                    .frame(minWidth: 760)
                    VStack(spacing: 12) {
                        welcomeSendCard
                        welcomeViewCard
                    }
                }
                historyCard
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationTitle("Nieuwsbrief")
        .refreshableCommand { await load() }
        .task { if !loaded { await load() } }
        .alert("Nieuwsbrief aanzetten?", isPresented: $confirmOn) {
            Button("Annuleren", role: .cancel) {}
            Button("Aanzetten") { Task { await setEnabled(true) } }
        } message: {
            Text(confirmText)
        }
        .alert("Maandoverzicht uitzetten?", isPresented: $confirmMonthlyOff) {
            Button("Annuleren", role: .cancel) {}
            Button("Uitzetten", role: .destructive) { Task { await setSection("monthly", false, "Maandoverzicht") } }
        } message: {
            Text("Er gaat dan op de laatste dag van de maand geen mail.")
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

    // MARK: verzending

    private var confirmText: String {
        guard let s = status else { return "" }
        var t = "Hij gaat naar \(Fmt.plural(s.recipientsTotal, "lid", "leden")) (\(Fmt.num(s.recipientsNl)) NL, \(Fmt.num(s.recipientsEn)) EN)."
        if let at = s.nextAt { t += "\n\nVolgende verzending: \(Fmt.longDateTimeNL(at))." }
        return t
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "Verzending",
                       subtitle: "Wekelijkse mail met nieuwe films en series, op zondag 09:00 en woensdag 18:00 (Nederlandse tijd), aan leden die mails van Bingr willen ontvangen. Standaard uit.")
            Text("Afzender: \(NewsletterStatus.sender)").font(.caption).foregroundStyle(Color.textSecondary)
            if let s = status {
                Toggle(isOn: Binding(get: { s.enabled }, set: { on in
                    if on { confirmOn = true } else { Task { await setEnabled(false) } }
                })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.enabled ? "Aan" : "Uit").font(.subheadline.weight(.bold))
                        Text(s.enabled ? "De nieuwsbrief wordt verstuurd" : "Er wordt niets verstuurd").font(.caption).foregroundStyle(Color.textDim)
                    }
                }
                .tint(.bingrRed)
                .disabled(switching)
                sectionsBlock(s)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 8)], alignment: .leading, spacing: 8) {
                    cell("Volgende verzending",
                         s.nextAt == nil ? "—" : s.enabled ? Fmt.longDateTimeNL(s.nextAt) : "uit",
                         hint: s.nextAt == nil ? nil : s.enabled ? "Nederlandse tijd" : "anders \(Fmt.longDateTimeNL(s.nextAt))", small: true)
                    cell("Ontvangers", Fmt.num(s.recipientsTotal), hint: "leden met mail aan")
                    cell("Nederlands", Fmt.num(s.recipientsNl), hint: "NL")
                    cell("Engels", Fmt.num(s.recipientsEn), hint: "EN")
                }
            } else if loadError == nil {
                ProgressView().frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .card()
    }

    /// Secties Top 10 / Populair: meteen opslaan (geldt voor de volgende editie en het voorbeeld).
    private func sectionsBlock(_ s: NewsletterStatus) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider().overlay(Color.line)
            Text("Secties").font(.subheadline.weight(.bold))
            Text("Uitgelicht, Nieuw om te kijken en Binnenkort staan er altijd in. Een sectie die uit staat, komt niet in de volgende editie en niet in het voorbeeld; een editie die al loopt verandert niet.")
                .font(.caption).foregroundStyle(Color.textDim)
            sectionToggle("Top 10 deze week", "Films en series apart (TMDB trending, aangevuld met Trakt), met IMDb-score", isOn: s.top10, key: "top10")
            sectionToggle("Populair", "Populaire films en series (TMDB), met IMDb-score", isOn: s.popular, key: "popular")
        }
    }

    private func sectionToggle(_ title: String, _ hint: String, isOn: Bool, key: String) -> some View {
        Toggle(isOn: Binding(get: { isOn }, set: { on in Task { await setSection(key, on, title) } })) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(hint).font(.caption).foregroundStyle(Color.textDim)
            }
        }
        .tint(.bingrRed)
        .disabled(switching)
    }

    private func cell(_ label: String, _ value: String, hint: String? = nil, small: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(Color.textSecondary).lineLimit(1)
            Text(value).font(small ? .subheadline.weight(.bold) : .title2.weight(.heavy)).monospacedDigit()
                .lineLimit(2).minimumScaleFactor(0.7)
            if let hint { Text(hint).font(.caption2).foregroundStyle(Color.textDim).lineLimit(2) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.surface2))
        .accessibilityElement(children: .combine)
    }

    // MARK: eigen mailing

    private var mailingCard: some View {
        NavigationLink {
            MailingView()
        } label: {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: "square.and.pencil").font(.title3).foregroundStyle(Color.bingrRed)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Eigen mailing").font(.headline).foregroundStyle(.white)
                    Text("Zelf een mail opstellen in NL en EN en versturen naar de nieuwsbrief-abonnees, of een servicebericht aan alle gebruikers.")
                        .font(.caption).foregroundStyle(Color.textDim).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(Color.textDim)
            }
            .card()
        }
        .buttonStyle(.plain)
    }

    // MARK: voorbeeld sturen

    private var sendCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "Voorbeeld sturen",
                       subtitle: "Stuurt de huidige editie alleen naar dit adres (bijvoorbeeld je eigen). Het adres wordt niet bewaard en niet gelogd.")
            VStack(alignment: .leading, spacing: 4) {
                Text("E-mailadres").font(.caption.weight(.semibold)).foregroundStyle(Color.textSecondary)
                TextField("", text: $to)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .fieldStyle()
                    .onChange(of: to) { _, v in if v.count > 254 { to = String(v.prefix(254)) } }
            }
            Picker("Taal", selection: $sendLang) {
                Text("Nederlands").tag("nl")
                Text("Engels").tag("en")
            }
            .pickerStyle(.segmented)
            if !sendError.isEmpty {
                Text(sendError).font(.subheadline).foregroundStyle(Color.warn)
            }
            Button {
                Task { await sendPreview() }
            } label: {
                HStack {
                    if sending { ProgressView().tint(.white) }
                    Text("Voorbeeld sturen")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bingr)
            .disabled(sending)
        }
        .card()
    }

    // MARK: voorbeeld bekijken

    private var viewCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "Voorbeeld bekijken", subtitle: "De huidige editie zoals de leden hem krijgen.")
            Picker("Taal", selection: $viewLang) {
                Text("NL").tag("nl")
                Text("EN").tag("en")
            }
            .pickerStyle(.segmented)
            Button {
                Task { await render() }
            } label: {
                HStack {
                    if rendering { ProgressView().tint(.white) }
                    Text("Voorbeeld tonen")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bingrGhost)
            .disabled(rendering)
        }
        .card()
    }

    // MARK: maandoverzicht

    private var monthlyCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "Maandoverzicht",
                       subtitle: "\"Volgende maand op Bingr\": op de laatste dag van elke maand om 18:00 (Nederlandse tijd) wat er de volgende maand nieuw komt: films in de bioscoop, nieuw op streaming en digitaal, nieuwe series en nieuwe seizoenen. Zelfde leden, opmaak en afmeldlink als de nieuwsbrief, één keer per maand. Gaat alleen als de nieuwsbrief ook aan staat.")
            if let s = status, let m = s.monthly {
                Toggle(isOn: Binding(get: { m.enabled }, set: { on in
                    if on { Task { await setSection("monthly", true, "Maandoverzicht") } } else { confirmMonthlyOff = true }
                })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(m.enabled ? "Aan" : "Uit").font(.subheadline.weight(.bold))
                        Text(!m.enabled ? "Er wordt geen maandoverzicht verstuurd" : s.enabled ? "Gaat op de laatste dag van de maand" : "Maar de nieuwsbrief staat uit, dus er gaat niets")
                            .font(.caption).foregroundStyle(Color.textDim)
                    }
                }
                .tint(.bingrRed)
                .disabled(switching)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 8)], alignment: .leading, spacing: 8) {
                    cell("Volgende verzending", Fmt.longDateTimeNL(m.nextAt), hint: m.nextKey.map { "over \(Fmt.monthNL($0))" }, small: true)
                    cell("Status", m.enabled && s.enabled ? "aan" : "uit", hint: m.enabled && s.enabled ? "zelfde ontvangers als de nieuwsbrief" : nil, small: true)
                }
                Divider().overlay(Color.line)
                Text("Testmail").font(.subheadline.weight(.bold))
                Text("Stuurt het maandoverzicht van de volgende maand alleen naar dit adres. Het adres wordt niet bewaard en niet gelogd. Zelfde limiet als het voorbeeld van de nieuwsbrief.")
                    .font(.caption).foregroundStyle(Color.textDim)
                TextField("E-mailadres", text: $mTo)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .fieldStyle()
                    .onChange(of: mTo) { _, v in if v.count > 254 { mTo = String(v.prefix(254)) } }
                Picker("Taal", selection: $mSendLang) {
                    Text("Nederlands").tag("nl")
                    Text("Engels").tag("en")
                }
                .pickerStyle(.segmented)
                if !mSendError.isEmpty {
                    Text(mSendError).font(.subheadline).foregroundStyle(Color.warn)
                }
                Button {
                    Task { await sendMonthlyPreview() }
                } label: {
                    HStack {
                        if mSending { ProgressView().tint(.white) }
                        Text("Testmail sturen")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bingr)
                .disabled(mSending)
                Divider().overlay(Color.line)
                Text("Voorbeeld").font(.subheadline.weight(.bold))
                Picker("Taal", selection: $mViewLang) {
                    Text("NL").tag("nl")
                    Text("EN").tag("en")
                }
                .pickerStyle(.segmented)
                Button {
                    Task { await renderMonthly() }
                } label: {
                    HStack {
                        if mRendering { ProgressView().tint(.white) }
                        Text("Voorbeeld tonen")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bingrGhost)
                .disabled(mRendering)
                Divider().overlay(Color.line)
                Text("Geschiedenis").font(.subheadline.weight(.bold))
                if m.editions.isEmpty { EmptyText(text: "Nog geen maandoverzicht verstuurd.") }
                ForEach(m.editions) { e in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 6) {
                                Chip(text: "MAAND")
                                Text(Fmt.monthNL(e.key)).font(.subheadline.weight(.bold))
                            }
                            HStack(spacing: 6) {
                                Text(Fmt.dateTime(e.createdAt)).font(.caption).foregroundStyle(Color.textDim)
                                if !e.done { Chip(text: "bezig", tone: .warn) }
                            }
                        }
                        Spacer(minLength: 8)
                        number(e.recipients, "ontvangers", .white)
                        number(e.sent, "verstuurd", .white)
                        number(e.failed, "mislukt", e.failed > 0 ? Color.warn : .white)
                    }
                    .accessibilityElement(children: .combine)
                }
            } else if status != nil {
                EmptyText(text: "Nog niet beschikbaar (workflow Backend in iptv-ios-appletv draaien).")
            } else if loadError != nil {
                EmptyText(text: "Geen gegevens.")
            } else {
                ProgressView().frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .card()
    }

    // MARK: welkomstmail

    private var welcomeCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "Welkomstmail",
                       subtitle: "Gaat automatisch naar nieuwe leden zodra ze hun e-mailadres hebben bevestigd (binnen 5 minuten, één keer per account): welkom, de eerste stappen (eigen bron, browser, tv koppelen, apps, hulp) en de nieuwsbrief met uitschrijflink. Los van de schakelaar hierboven; de alinea over de nieuwsbrief staat er alleen in als die aan staat en het lid ingeschreven is. Ook als iemand alle berichten heeft uitgezet. Leden van vóór de invoering krijgen hem niet.")
            if let s = status {
                if let w = s.welcome {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 8)], alignment: .leading, spacing: 8) {
                        cell("Verstuurd", Fmt.num(w.sent7d), hint: "laatste 7 dagen")
                        cell("Wachtend", Fmt.num(w.pending), hint: "gaat binnen 5 minuten")
                    }
                } else {
                    EmptyText(text: "Nog geen gegevens (workflow Backend in iptv-ios-appletv draaien).")
                }
            } else if loadError != nil {
                EmptyText(text: "Geen gegevens.")
            } else {
                ProgressView().frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .card()
    }

    private var welcomeSendCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "Welkomstmail: voorbeeld sturen",
                       subtitle: "Stuurt de welkomstmail (met de voorbeeldnaam Alex) alleen naar dit adres. Het adres wordt niet bewaard en niet gelogd. Zelfde limiet als het voorbeeld van de nieuwsbrief.")
            VStack(alignment: .leading, spacing: 4) {
                Text("E-mailadres").font(.caption.weight(.semibold)).foregroundStyle(Color.textSecondary)
                TextField("", text: $wTo)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .fieldStyle()
                    .onChange(of: wTo) { _, v in if v.count > 254 { wTo = String(v.prefix(254)) } }
            }
            Picker("Taal", selection: $wSendLang) {
                Text("Nederlands").tag("nl")
                Text("Engels").tag("en")
            }
            .pickerStyle(.segmented)
            if !wSendError.isEmpty {
                Text(wSendError).font(.subheadline).foregroundStyle(Color.warn)
            }
            Button {
                Task { await sendWelcomePreview() }
            } label: {
                HStack {
                    if wSending { ProgressView().tint(.white) }
                    Text("Voorbeeld sturen")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bingr)
            .disabled(wSending)
        }
        .card()
    }

    private var welcomeViewCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "Welkomstmail: voorbeeld bekijken", subtitle: "De welkomstmail zoals nieuwe leden hem krijgen (met de voorbeeldnaam).")
            Picker("Taal", selection: $wViewLang) {
                Text("NL").tag("nl")
                Text("EN").tag("en")
            }
            .pickerStyle(.segmented)
            Button {
                Task { await renderWelcome() }
            } label: {
                HStack {
                    if wRendering { ProgressView().tint(.white) }
                    Text("Voorbeeld tonen")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bingrGhost)
            .disabled(wRendering)
        }
        .card()
    }

    // MARK: geschiedenis

    private var historyCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "Geschiedenis",
                       subtitle: "Verstuurde edities met het aantal ontvangers. Verstuurd = aangenomen door de mailserver; of de mail in de inbox kwam, meldt die niet.")
            if let s = status {
                if s.editions.isEmpty { EmptyText(text: "Nog geen edities verstuurd.") }
                ForEach(s.editions) { e in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 6) {
                                Chip(text: "EDITIE")
                                Text(e.key ?? "—").font(.subheadline.weight(.bold))
                            }
                            HStack(spacing: 6) {
                                Text(Fmt.dateTime(e.createdAt)).font(.caption).foregroundStyle(Color.textDim)
                                if !e.done { Chip(text: "bezig", tone: .warn) }
                            }
                        }
                        Spacer(minLength: 8)
                        number(e.recipients, "ontvangers", .white)
                        number(e.sent, "verstuurd", .white)
                        number(e.failed, "mislukt", e.failed > 0 ? Color.warn : .white)
                    }
                    .accessibilityElement(children: .combine)
                    if e.id != s.editions.last?.id { Divider().overlay(Color.line) }
                }
            } else if loadError != nil {
                EmptyText(text: "Geen gegevens.")
            }
        }
        .card()
    }

    private func number(_ n: Int, _ label: String, _ color: Color) -> some View {
        VStack(alignment: .trailing, spacing: 0) {
            Text(Fmt.num(n)).font(.headline.monospacedDigit()).foregroundStyle(color)
            Text(label).font(.caption2).foregroundStyle(Color.textDim)
        }
    }

    // MARK: acties

    private func load() async {
        do {
            let r = try await session.call("newsletter_status")
            status = NewsletterStatus(r)
            loadError = nil
        } catch let e as APIError {
            if e.code == "auth" { return }
            status = nil
            loadError = e.errorDescription
        } catch {
            return
        }
        loaded = true
    }

    private func setEnabled(_ on: Bool) async {
        switching = true
        defer { switching = false }
        do {
            let r = try await session.call("newsletter_set_enabled", ["enabled": on])
            let now = r["enabled"].bool ?? on
            status?.enabled = now
            session.show(now ? "Nieuwsbrief staat aan." : "Nieuwsbrief staat uit.")
            await load()
        } catch {
            session.report(error)
        }
    }

    private func setSection(_ key: String, _ on: Bool, _ title: String) async {
        switching = true
        defer { switching = false }
        do {
            let r = try await session.call("newsletter_set_sections", [key: on])
            let top10 = r["sections"]["top10"].bool ?? (key == "top10" ? on : status?.top10 ?? true)
            let popular = r["sections"]["popular"].bool ?? (key == "popular" ? on : status?.popular ?? true)
            let monthly = r["sections"]["monthly"].bool ?? (key == "monthly" ? on : status?.monthly?.enabled ?? true)
            status?.top10 = top10
            status?.popular = popular
            status?.monthly?.enabled = monthly
            let now = key == "top10" ? top10 : key == "popular" ? popular : monthly
            session.show("\(title) staat \(now ? "aan" : "uit").")
        } catch {
            session.report(error)
        }
    }

    private func sendPreview() async {
        sendError = ""
        let address = to.trimmingCharacters(in: .whitespacesAndNewlines)
        guard EmailCheck.looksValid(address) else { sendError = APIError.text("bad_email"); return }
        sending = true
        defer { sending = false }
        do {
            _ = try await session.call("newsletter_preview", ["to": address, "lang": sendLang])
            session.show("Voorbeeld (\(sendLang.uppercased())) verstuurd.")
        } catch let e as APIError {
            if e.code != "auth" { sendError = e.errorDescription ?? "" }
        } catch {}
    }

    private func render() async {
        rendering = true
        defer { rendering = false }
        do {
            let r = try await session.call("newsletter_render", ["lang": viewLang])
            guard let html = r["html"].string, !html.isEmpty else { session.show(APIError.text("server_error"), bad: true); return }
            rendered = RenderedMail(subject: r["subject"].string ?? "", html: html)
        } catch {
            session.report(error)
        }
    }
}

extension NewsletterView {
    fileprivate func sendMonthlyPreview() async {
        mSendError = ""
        let address = mTo.trimmingCharacters(in: .whitespacesAndNewlines)
        guard EmailCheck.looksValid(address) else { mSendError = APIError.text("bad_email"); return }
        mSending = true
        defer { mSending = false }
        do {
            _ = try await session.call("monthly_preview", ["to": address, "lang": mSendLang])
            session.show("Testmail van het maandoverzicht (\(mSendLang.uppercased())) verstuurd.")
        } catch let e as APIError {
            if e.code != "auth" { mSendError = e.errorDescription ?? "" }
        } catch {}
    }

    fileprivate func renderMonthly() async {
        mRendering = true
        defer { mRendering = false }
        do {
            let r = try await session.call("monthly_render", ["lang": mViewLang])
            guard let html = r["html"].string, !html.isEmpty else { session.show(APIError.text("server_error"), bad: true); return }
            rendered = RenderedMail(subject: r["subject"].string ?? "", html: html)
        } catch {
            session.report(error)
        }
    }

    fileprivate func sendWelcomePreview() async {
        wSendError = ""
        let address = wTo.trimmingCharacters(in: .whitespacesAndNewlines)
        guard EmailCheck.looksValid(address) else { wSendError = APIError.text("bad_email"); return }
        wSending = true
        defer { wSending = false }
        do {
            _ = try await session.call("welcome_preview", ["to": address, "lang": wSendLang])
            session.show("Voorbeeld van de welkomstmail (\(wSendLang.uppercased())) verstuurd.")
        } catch let e as APIError {
            if e.code != "auth" { wSendError = e.errorDescription ?? "" }
        } catch {}
    }

    fileprivate func renderWelcome() async {
        wRendering = true
        defer { wRendering = false }
        do {
            let r = try await session.call("welcome_render", ["lang": wViewLang])
            guard let html = r["html"].string, !html.isEmpty else { session.show(APIError.text("server_error"), bad: true); return }
            rendered = RenderedMail(subject: r["subject"].string ?? "", html: html)
        } catch {
            session.report(error)
        }
    }
}

struct RenderedMail: Identifiable {
    let id = UUID()
    let subject: String
    let html: String
}

/// De mail als HTML, zonder JavaScript; links openen in de standaardbrowser.
struct MailPreview: UIViewRepresentable {
    let html: String

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.loadHTMLString(html, baseURL: nil)
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url else { return .allow }
            if ["https", "mailto"].contains(url.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
            return .cancel
        }
    }
}
