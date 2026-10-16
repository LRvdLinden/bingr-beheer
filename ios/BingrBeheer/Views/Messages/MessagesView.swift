import SwiftUI

/// Tab Pushmeldingen (vroeger Berichten): nieuwe pushmelding (NL/EN, link, doelgroep) met voorbeeld, bevestiging met het
/// aantal apparaten, voortgang, de geschiedenis (ook releasemeldingen) en de e-mails/oude berichten. Zoals de tab in
/// web/admin.js; acties push_count, push_send, push_progress, push_history (functie admin → push, docs/PUSH.md).
struct MessagesView: View {
    @Environment(Session.self) private var session

    // opstellen
    @State private var titleNl = ""
    @State private var bodyNl = ""
    @State private var titleEn = ""
    @State private var bodyEn = ""
    @State private var link = ""
    @State private var audience: PushAudience = .all
    @State private var platformIDs: Set<String> = Set(PushPlatformOption.withPush.map(\.id))
    @State private var selectedAccounts: [UserRow] = []
    @State private var accountQuery = ""
    @State private var accountResults: [UserRow] = []
    @State private var mail = false
    @State private var previewLang = "nl"
    @State private var error = ""
    @State private var busy = false
    @State private var pending: PendingPush?

    // geschiedenis
    @State private var history: [PushMessage] = []
    @State private var historyError: String?
    @State private var historyLoaded = false
    @State private var page = 0
    @State private var hasMore = false

    // e-mail en oude berichten
    @State private var announcements: [Announcement] = []
    @State private var smtpOK = true
    @State private var annLoaded = false
    @State private var deleting: Announcement?

    private static let titleMax = 100
    private static let bodyMax = 600

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 12) {
                        composeCard
                        previewCard.frame(maxWidth: 380)
                    }
                    .frame(minWidth: 760)
                    VStack(spacing: 12) {
                        composeCard
                        previewCard
                    }
                }
                historyCard
                announcementsCard
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationTitle("Pushmeldingen")
        .refreshableCommand { await loadAll() }
        .task { if !historyLoaded { await loadAll() } }
        .onChange(of: session.announcementsVersion) { _, _ in Task { await loadAnnouncements() } }
        .onChange(of: session.pushVersion) { _, _ in Task { await loadHistory() } }
        .onChange(of: audience) { _, a in if a != .all { mail = false } }
        .task(id: accountQuery) { await searchAccounts() }
        .alert("Pushmelding versturen", isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }), presenting: pending) { p in
            Button("Annuleren", role: .cancel) {}
            Button(p.devices == 0 ? "Alleen e-mailen" : (p.mail ? "Versturen en e-mailen" : "Versturen")) { Task { await send(p) } }
        } message: { p in
            Text(p.message)
        }
        .alert("Bericht verwijderen", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), presenting: deleting) { a in
            Button("Annuleren", role: .cancel) {}
            Button("Verwijderen", role: .destructive) { Task { await delete(a) } }
        } message: { a in
            Text("\"\(a.titleNl)\" uit de lijst verwijderen?")
        }
    }

    // MARK: opstellen

    private var pushRunning: Bool { session.pushProgress.map { !$0.done } ?? false }
    private var mailRunning: Bool { session.mailProgress.map { !$0.done } ?? false }

    private var composeCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            CardHeader(title: "Nieuwe pushmelding",
                       subtitle: "Een systeemmelding op iPhone, iPad, Mac, Android en in de webspeler, op apparaten waar meldingen zijn toegestaan.")
            GroupBox {
                VStack(alignment: .leading, spacing: 10) {
                    field("Titel", text: $titleNl)
                    editor("Tekst", text: $bodyNl)
                }
            } label: {
                Text("Nederlands").font(.subheadline.weight(.semibold))
            }
            .backgroundStyle(Color.surface2)
            GroupBox {
                VStack(alignment: .leading, spacing: 10) {
                    field("Title", text: $titleEn)
                    editor("Text", text: $bodyEn)
                }
            } label: {
                HStack(spacing: 6) {
                    Text("Engels").font(.subheadline.weight(.semibold))
                    Text("(leeg = Nederlands voor iedereen)").font(.caption).foregroundStyle(Color.textDim)
                }
            }
            .backgroundStyle(Color.surface2)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text("Link").font(.caption.weight(.semibold)).foregroundStyle(Color.textSecondary)
                    Text("(optioneel, alleen https; zonder link opent de app)").font(.caption).foregroundStyle(Color.textDim)
                }
                TextField("https://bingr.online/…", text: $link)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textContentType(.URL)
                    .fieldStyle()
                    .onChange(of: link) { _, v in if v.count > 500 { link = String(v.prefix(500)) } }
            }

            audienceSection

            Toggle("Ook per e-mail sturen", isOn: $mail)
                .disabled(!smtpOK || audience != .all)
            Text(smtpOK ? "E-mail gaat naar alle accounts met berichtenmail aan; alleen bij Alle gebruikers."
                        : "E-mail is niet ingesteld (BINGR_SMTP_* ontbreken).")
                .font(.caption).foregroundStyle(Color.textDim)
                .opacity(audience == .all ? 1 : 0.6)

            if !error.isEmpty {
                Text(error).font(.subheadline).foregroundStyle(Color.warn)
            }
            Button {
                Task { await prepare() }
            } label: {
                HStack {
                    if busy { ProgressView().tint(.white) }
                    Text(mail ? "Versturen en e-mailen" : "Versturen")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bingr)
            .disabled(busy || pushRunning || mailRunning)

            if let p = session.pushProgress {
                VStack(alignment: .leading, spacing: 6) {
                    ProgressView(value: p.fraction).tint(Color.ok)
                    Text(p.text).font(.caption).foregroundStyle(Color.textDim)
                }
            }
            if let p = session.mailProgress {
                VStack(alignment: .leading, spacing: 6) {
                    ProgressView(value: p.fraction).tint(Color.stateInfo)
                    Text("E-mail: " + p.text).font(.caption).foregroundStyle(Color.textDim)
                }
            }
        }
        .card()
    }

    private var audienceSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Doelgroep").font(.subheadline.weight(.semibold))
            Picker("Doelgroep", selection: $audience) {
                Text("Alle gebruikers").tag(PushAudience.all)
                Text("Accounts").tag(PushAudience.accounts)
                Text("Platforms").tag(PushAudience.platforms)
            }
            .pickerStyle(.segmented)
            .accessibilityLabel("Doelgroep")

            switch audience {
            case .all:
                EmptyView()
            case .accounts:
                accountPicker
            case .platforms:
                platformPicker
            }
        }
    }

    private var accountPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(Color.textDim)
                TextField("Zoek op naam of begin van e-mailadres", text: $accountQuery)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if !accountQuery.isEmpty {
                    Button { accountQuery = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Color.textDim) }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Zoekterm wissen")
                }
            }
            .fieldStyle()

            if !accountResults.isEmpty {
                VStack(spacing: 0) {
                    ForEach(accountResults) { u in
                        let on = selectedAccounts.contains { $0.id == u.id }
                        Button { toggle(u) } label: {
                            HStack(spacing: 8) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(u.fullName ?? u.email).font(.subheadline.weight(.semibold))
                                    if u.fullName != nil { Text(u.email).font(.caption).foregroundStyle(Color.textDim) }
                                }
                                Spacer()
                                Image(systemName: on ? "checkmark.circle.fill" : "plus.circle")
                                    .foregroundStyle(on ? Color.ok : Color.textSecondary)
                            }
                            .padding(.vertical, 8)
                            .padding(.horizontal, 10)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(on ? "\(u.fullName ?? u.email), gekozen" : (u.fullName ?? u.email))
                        if u.id != accountResults.last?.id { Divider().overlay(Color.line) }
                    }
                }
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.surface3))
            } else if accountQuery.trimmingCharacters(in: .whitespaces).count >= 2 {
                EmptyText(text: "Geen accounts gevonden.")
            }

            if selectedAccounts.isEmpty {
                Text("Nog geen accounts gekozen.").font(.caption).foregroundStyle(Color.textDim)
            } else {
                Text(Fmt.plural(selectedAccounts.count, "account gekozen", "accounts gekozen"))
                    .font(.caption.weight(.semibold)).foregroundStyle(Color.textSecondary)
                ForEach(selectedAccounts) { u in
                    HStack(spacing: 8) {
                        Image(systemName: "person.crop.circle").foregroundStyle(Color.textDim)
                        Text(u.fullName.map { "\($0) (\(u.email))" } ?? u.email).font(.subheadline).lineLimit(1)
                        Spacer()
                        Button { selectedAccounts.removeAll { $0.id == u.id } } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(Color.textSecondary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(u.fullName ?? u.email) weghalen")
                    }
                }
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.surface2))
    }

    private var platformPicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(PushPlatformOption.withPush) { o in
                Toggle(isOn: Binding(get: { platformIDs.contains(o.id) },
                                     set: { on in if on { platformIDs.insert(o.id) } else { platformIDs.remove(o.id) } })) {
                    Label(o.label, systemImage: o.icon)
                }
                .tint(.bingrRed)
            }
            ForEach(PushPlatformOption.withoutPush) { o in
                HStack {
                    Label(o.label, systemImage: o.icon)
                    Spacer()
                    Text("geen systeem-push").font(.caption)
                }
                .foregroundStyle(Color.textDim)
                .accessibilityElement(children: .combine)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.surface2))
    }

    private func field(_ label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(Color.textSecondary)
            TextField("", text: text)
                .fieldStyle()
                .onChange(of: text.wrappedValue) { _, v in
                    if v.count > Self.titleMax { text.wrappedValue = String(v.prefix(Self.titleMax)) }
                }
        }
    }

    private func editor(_ label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(Color.textSecondary)
            TextField("", text: text, axis: .vertical)
                .lineLimit(3...8)
                .fieldStyle()
                .onChange(of: text.wrappedValue) { _, v in
                    if v.count > Self.bodyMax { text.wrappedValue = String(v.prefix(Self.bodyMax)) }
                }
        }
    }

    // MARK: voorbeeld (zoals een systeemmelding)

    private var previewCard: some View {
        let en = previewLang == "en" && !trim(titleEn).isEmpty && !trim(bodyEn).isEmpty
        let title = trim(en ? titleEn : titleNl)
        let text = trim(en ? bodyEn : bodyNl)
        let host = validLink(trim(link)).flatMap { URL(string: $0)?.host }
        return VStack(alignment: .leading, spacing: 14) {
            HStack {
                CardHeader(title: "Voorbeeld")
                Spacer()
                Picker("Taal", selection: $previewLang) {
                    Text("NL").tag("nl")
                    Text("EN").tag("en")
                }
                .pickerStyle(.segmented)
                .frame(width: 110)
            }
            HStack(alignment: .top, spacing: 12) {
                Image("MenuIcon")
                    .resizable()
                    .interpolation(.high)
                    .frame(width: 38, height: 38)
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text("BINGR").font(.caption.weight(.semibold))
                        Spacer()
                        Text("nu").font(.caption)
                    }
                    .foregroundStyle(Color.white.opacity(0.6))
                    Text(title.isEmpty ? "Titel" : title).font(.subheadline.weight(.bold)).lineLimit(1)
                    Text(text.isEmpty ? "Tekst van de melding" : text).font(.subheadline).foregroundStyle(Color(hex: 0xE6E6E6)).lineLimit(4)
                    if let host {
                        Text("Opent \(host)").font(.caption).foregroundStyle(Color(hex: 0x9CC3FF)).lineLimit(1).padding(.top, 4)
                    }
                }
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Color(hex: 0x2B2B2B)))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.white.opacity(0.1)))
            .padding(.vertical, 28)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0x0E0E0E)))
            Text("Zo ongeveer ziet de melding eruit; elk systeem toont hem in zijn eigen stijl en kort lange teksten in.")
                .font(.caption).foregroundStyle(Color.textDim)
        }
        .card()
    }

    // MARK: geschiedenis

    private var historyCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "Geschiedenis",
                       subtitle: "Pushmeldingen van het beheer, automatische releasemeldingen en herinneringen. Verstuurd = aangenomen door Apple (APNs), Google (FCM) of de browserdienst (Web Push); of de melding op het toestel verscheen, melden deze kanalen niet. Ongeldig = token verlopen of app verwijderd (opgeruimd).")
            if let historyError {
                EmptyText(text: historyError)
            } else if historyLoaded && history.isEmpty {
                EmptyText(text: page > 0 ? "Geen oudere meldingen." : "Nog geen pushmeldingen.")
            }
            ForEach(history) { m in
                PushMessageRow(item: m)
                if m.id != history.last?.id { Divider().overlay(Color.line) }
            }
            if page > 0 || hasMore {
                HStack(spacing: 12) {
                    Button("Nieuwere") { page -= 1; Task { await loadHistory() } }
                        .buttonStyle(.bingrGhost).disabled(page == 0)
                    Text("Pagina \(page + 1)").font(.caption).foregroundStyle(Color.textSecondary)
                    Button("Oudere") { page += 1; Task { await loadHistory() } }
                        .buttonStyle(.bingrGhost).disabled(!hasMore)
                }
                .controlSize(.small)
                .frame(maxWidth: .infinity)
            }
        }
        .card()
    }

    private var announcementsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "E-mail en oude berichten",
                       subtitle: "Berichten per e-mail, en de berichten van vóór de pushmeldingen (in-app banner, bestaat niet meer).")
            if annLoaded && announcements.isEmpty {
                EmptyText(text: "Nog geen berichten.")
            }
            ForEach(announcements) { a in
                AnnouncementRow(item: a, canResume: !mailRunning,
                                resume: { Task { await sendMails(id: a.id, total: a.emailTotal) } },
                                delete: { deleting = a })
                if a.id != announcements.last?.id { Divider().overlay(Color.line) }
            }
        }
        .card()
    }

    // MARK: acties

    private func trim(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Alleen https met een echte hostnaam (de functie controleert het nog een keer). nil = ongeldig of leeg.
    private func validLink(_ s: String) -> String? {
        guard !s.isEmpty, let u = URL(string: s), u.scheme?.lowercased() == "https",
              let h = u.host, h.contains("."), u.user == nil, u.password == nil else { return nil }
        return s
    }

    private func toggle(_ u: UserRow) {
        if selectedAccounts.contains(where: { $0.id == u.id }) {
            selectedAccounts.removeAll { $0.id == u.id }
        } else if selectedAccounts.count >= 500 {
            session.show(APIError.text("too_many_accounts"), bad: true)
        } else {
            selectedAccounts.append(u)
        }
    }

    /// Zoeken zoals op de pagina Gebruikers (actie users met q), met een korte pauze na het typen.
    private func searchAccounts() async {
        let q = trim(accountQuery)
        guard audience == .accounts, q.count >= 2 else { accountResults = []; return }
        try? await Task.sleep(for: .milliseconds(250))
        if Task.isCancelled { return }
        do {
            let r = try await session.call("users", ["q": q, "page": 0, "page_size": 8])
            if !Task.isCancelled { accountResults = r["items"].array.map(UserRow.init) }
        } catch {
            session.report(error)
        }
    }

    private func target() -> [String: Any]? {
        switch audience {
        case .all:
            return ["all": true]
        case .accounts:
            return selectedAccounts.isEmpty ? nil : ["accounts": selectedAccounts.map(\.id)]
        case .platforms:
            let keys = PushPlatformOption.withPush.filter { platformIDs.contains($0.id) }.flatMap(\.keys)
            return keys.isEmpty ? nil : ["platforms": keys]
        }
    }

    /// Controleren, apparaten tellen (push_count) en om bevestiging vragen.
    private func prepare() async {
        error = ""
        let tNl = trim(titleNl), bNl = trim(bodyNl), tEn = trim(titleEn), bEn = trim(bodyEn), url = trim(link)
        if tNl.isEmpty || bNl.isEmpty { error = APIError.text("text_missing"); return }
        if tEn.isEmpty != bEn.isEmpty { error = APIError.text("en_incomplete"); return }
        if !url.isEmpty && validLink(url) == nil { error = APIError.text("bad_link"); return }
        guard let t = target() else { error = APIError.text(audience == .accounts ? "no_accounts" : "no_platforms"); return }
        let withMail = mail && smtpOK && audience == .all

        busy = true
        defer { busy = false }
        var devices: Int?
        var parts = ""
        var accountsLine = ""
        do {
            let c = try await session.call("push_count", ["target": t])
            devices = c["devices"].int
            if let by = c["by_platform"].object {
                parts = ["ios", "ipados", "macos", "android", "web"].compactMap { k in
                    guard let n = by[k]?.int, n > 0 else { return nil }
                    return "\(PushPlatformOption.name(k)) \(Fmt.num(n))"
                }.joined(separator: ", ")
            }
            if audience == .accounts, let n = c["accounts"].int {
                accountsLine = "\n\n\(Fmt.num(n)) van de \(Fmt.num(selectedAccounts.count)) gekozen accounts \(n == 1 ? "heeft" : "hebben") pushmeldingen aan."
            }
        } catch let e as APIError {
            if e.code == "auth" { return }
            // validatiefout: melden; anders (server, netwerk) het aantal als onbekend tonen
            if e.status == 400 { error = e.errorDescription ?? ""; return }
        } catch {
            return
        }
        if devices == 0 && !withMail {
            error = "Geen apparaten met pushmeldingen in deze doelgroep; er is niets verstuurd."
            return
        }
        var message: String
        if let n = devices {
            message = n == 0 ? "Geen apparaten met pushmeldingen in deze doelgroep. Alleen de e-mail versturen?"
                : "Pushmelding versturen naar \(Fmt.plural(n, "apparaat", "apparaten"))\(parts.isEmpty ? "" : " (\(parts))")?\(accountsLine)"
        } else {
            message = "Het aantal apparaten is nog niet bekend. Toch versturen?"
        }
        if withMail { message += "\n\nDaarna gaat hetzelfde bericht ook per e-mail naar alle accounts met berichtenmail aan." }

        var params: [String: Any] = ["title_nl": tNl, "body_nl": bNl, "target": t]
        if !tEn.isEmpty { params["title_en"] = tEn; params["body_en"] = bEn }
        if !url.isEmpty { params["url"] = url }
        pending = PendingPush(message: message, devices: devices, params: params, mail: withMail,
                              mailParams: ["title_nl": tNl, "body_nl": bNl, "title_en": tEn, "body_en": bEn, "email": true])
    }

    private func send(_ p: PendingPush) async {
        busy = true
        defer { busy = false }
        var messageID: String?
        do {
            if p.devices != 0 {
                let r = try await session.call("push_send", p.params.mapValues { Optional($0) })
                let progress = PushProgress(r)
                session.pushProgress = progress
                messageID = progress.done ? nil : progress.messageID
                if progress.done { session.show("Pushmelding: \(progress.counts.text).", bad: progress.counts.failed > 0) }
            }
        } catch let e as APIError {
            if e.code != "auth" { error = e.errorDescription ?? "" }
            return
        } catch {
            return
        }
        // verstuurd: formulier leeg, geschiedenis vernieuwen
        titleNl = ""; bodyNl = ""; titleEn = ""; bodyEn = ""; link = ""; mail = false
        page = 0
        session.pushVersion += 1
        if p.mail {
            do {
                let a = try await session.call("announce", p.mailParams.mapValues { Optional($0) })
                if let id = a["id"].text {
                    let total = a["email_total"].int ?? 0
                    session.announcementsVersion += 1
                    Task { await sendMails(id: id, total: total) }
                }
            } catch let e as APIError {
                if e.code != "auth" { session.show("Pushmelding verstuurd, maar de e-mail niet: \(e.errorDescription ?? "")", bad: true) }
            } catch {}
        }
        if let messageID { await followPush(messageID) }
    }

    /// Voortgang: push_progress herhalen tot done (versturen gaat in batches).
    private func followPush(_ id: String) async {
        for _ in 0..<600 {
            try? await Task.sleep(for: .milliseconds(1500))
            do {
                let r = try await session.call("push_progress", ["message_id": id])
                let p = PushProgress(r)
                session.pushProgress = p
                if p.done {
                    session.show("Pushmelding: \(p.counts.text).", bad: p.counts.failed > 0)
                    break
                }
            } catch {
                if let e = error as? APIError, e.code != "auth" {
                    session.show("\(e.errorDescription ?? "") De voortgang staat ook in de geschiedenis.", bad: true)
                }
                session.pushProgress?.done = true
                break
            }
        }
        session.pushVersion += 1
    }

    /// Verstuurt de mails in batches (`announce_send` herhalen tot done), zoals sendMails() in admin.js.
    private func sendMails(id: String, total: Int) async {
        if let p = session.mailProgress, !p.done { return }
        session.mailProgress = MailProgress(announcementID: id, total: total)
        var last = JSON.null
        for _ in 0..<2000 {
            do {
                last = try await session.call("announce_send", ["id": id])
            } catch {
                if let e = error as? APIError, e.code != "auth" {
                    session.show("\(e.errorDescription ?? "") Je kunt later verder verzenden.", bad: true)
                }
                session.mailProgress?.done = true
                session.announcementsVersion += 1
                return
            }
            let done = last["done"].bool ?? false
            session.mailProgress = MailProgress(announcementID: id, total: last["email_total"].int ?? total,
                                                sent: last["email_sent"].int ?? 0, failed: last["email_failed"].int ?? 0, done: done)
            if done { break }
            try? await Task.sleep(for: .milliseconds(800))
        }
        session.mailProgress?.done = true
        let sent = last["email_sent"].int ?? 0, failed = last["email_failed"].int ?? 0
        session.show("E-mail klaar: \(Fmt.num(sent)) verstuurd\(failed > 0 ? ", \(Fmt.num(failed)) mislukt" : "").", bad: failed > 0)
        session.announcementsVersion += 1
    }

    private func delete(_ a: Announcement) async {
        do {
            try await session.call("announcement_delete", ["id": a.id])
            session.show("Bericht verwijderd.")
            await loadAnnouncements()
        } catch {
            session.report(error)
        }
    }

    private func loadAll() async {
        await loadHistory()
        await loadAnnouncements()
    }

    private func loadHistory() async {
        do {
            let r = try await session.call("push_history", ["page": page])
            history = r["items"].array.map(PushMessage.init)
            hasMore = r["has_more"].bool ?? false
            historyError = nil
        } catch let e as APIError {
            if e.code == "auth" { return }
            history = []
            hasMore = false
            historyError = e.errorDescription
        } catch {
            return
        }
        historyLoaded = true
    }

    private func loadAnnouncements() async {
        do {
            let r = try await session.call("announcements_list")
            announcements = r["items"].array.map(Announcement.init)
            smtpOK = r["smtp"].bool != false
            if !smtpOK { mail = false }
            annLoaded = true
        } catch {
            session.report(error)
        }
    }
}

/// Bevestiging vóór versturen (met het aantal apparaten uit push_count).
struct PendingPush: Identifiable {
    let id = UUID()
    let message: String
    /// nil = aantal onbekend; 0 = geen apparaten (dan alleen de e-mail).
    let devices: Int?
    let params: [String: Any]
    let mail: Bool
    let mailParams: [String: Any]
}

/// Eén pushmelding in de geschiedenis: soort, titel, datum, doelgroep en de tellers.
struct PushMessageRow: View {
    let item: PushMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Chip(text: item.kindLabel.uppercased(), tone: item.kindTone)
                Text(item.displayTitle).font(.subheadline.weight(.bold))
            }
            if item.kind != "release", let b = item.body {
                Text(b).font(.subheadline).foregroundStyle(Color.textSecondary).lineLimit(2)
            }
            HStack(spacing: 6) {
                Text(Fmt.dateTime(item.createdAt))
                Text("· \(item.targetText)")
                if let h = item.urlHost { Text("· link naar \(h)") }
            }
            .font(.caption)
            .foregroundStyle(Color.textDim)
            if !item.notes.isEmpty {
                HStack(spacing: 6) {
                    ForEach(item.notes, id: \.self) { Chip(text: PushCounts.note($0), tone: .warn) }
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 16) {
                number(item.counts.queued, "in wachtrij", item.counts.queued > 0 ? Color.stateDegraded : .white)
                number(item.counts.sent, "verstuurd", .white)
                number(item.counts.failed, "mislukt", item.counts.failed > 0 ? Color.warn : .white)
                number(item.counts.invalid, "ongeldig", Color.textSecondary)
                Spacer(minLength: 0)
            }
            Text(Fmt.plural(item.devices, "apparaat", "apparaten") + (item.done ? "" : " · bezig"))
                .font(.caption).foregroundStyle(Color.textDim)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private func number(_ n: Int, _ label: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(Fmt.num(n)).font(.headline.monospacedDigit()).foregroundStyle(color)
            Text(label).font(.caption2).foregroundStyle(Color.textDim)
        }
    }
}

/// E-mail of oud bericht (announcements_list).
struct AnnouncementRow: View {
    let item: Announcement
    let canResume: Bool
    let resume: () -> Void
    let delete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(item.titleNl).font(.subheadline.weight(.bold))
                if let en = item.titleEn { Text("/ \(en)").font(.caption).foregroundStyle(Color.textDim) }
            }
            Text(item.bodyNl).font(.subheadline).foregroundStyle(Color.textSecondary).lineLimit(4)
            HStack(spacing: 6) {
                Chip(text: item.mailOnly ? "E-mail" : "Banner (oud)", tone: .neutral, icon: item.mailOnly ? "envelope" : nil)
                Text(Fmt.dateTime(item.createdAt))
            }
            .font(.caption)
            .foregroundStyle(Color.textDim)
            if item.email {
                Text("E-mail: \(Fmt.num(item.emailSent)) / \(Fmt.num(item.emailTotal))"
                     + (item.emailFailed > 0 ? ", \(Fmt.num(item.emailFailed)) mislukt" : "")
                     + (item.emailDoneAt == nil ? " (niet afgerond)" : ""))
                    .font(.caption).foregroundStyle(Color.textDim)
            }
            HStack(spacing: 8) {
                if item.canResume {
                    Button("Verder verzenden", action: resume).buttonStyle(.bingrGhost).disabled(!canResume)
                }
                Button("Verwijderen", action: delete).buttonStyle(.bingrDanger)
            }
            .controlSize(.small)
        }
        .padding(.vertical, 4)
    }
}
