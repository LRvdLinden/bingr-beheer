import SwiftUI
import WebKit

/// Onderdeel Nieuwsbrief (zoals de tab in web/admin.js): schakelaar aan/uit (bevestiging bij aanzetten met het aantal
/// leden), volgende verzending (NL-tijd), ontvangers NL/EN, voorbeeld sturen naar één adres (nooit bewaard of gelogd),
/// voorbeeld bekijken en de geschiedenis van edities. Acties newsletter_status, newsletter_set_enabled,
/// newsletter_preview en newsletter_render (functie admin → newsletter). Blok Welkomstmail: aantallen uit
/// newsletter_status.welcome, voorbeeld sturen (welcome_preview) en bekijken (welcome_render).
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

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let loadError { NoticeBanner(text: loadError) }
                statusCard
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
