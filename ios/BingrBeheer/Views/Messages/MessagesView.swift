import SwiftUI

/// Tab Berichten: nieuw bericht (NL/EN) met voorbeeld, optioneel per e-mail, en de geplaatste berichten.
struct MessagesView: View {
    @Environment(Session.self) private var session

    @State private var titleNl = ""
    @State private var bodyNl = ""
    @State private var titleEn = ""
    @State private var bodyEn = ""
    @State private var hasExpiry = false
    @State private var expiry = Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date()
    @State private var mail = false
    @State private var previewLang = "nl"
    @State private var error = ""
    @State private var posting = false
    @State private var confirmPost = false

    @State private var items: [Announcement] = []
    @State private var smtpOK = true
    @State private var loaded = false
    @State private var deleting: Announcement?

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
                listCard
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationTitle("Berichten")
        .refreshableCommand { await load() }
        .task { if !loaded { await load() } }
        .onChange(of: session.announcementsVersion) { _, _ in Task { await load() } }
        .alert("Bericht plaatsen", isPresented: $confirmPost) {
            Button("Annuleren", role: .cancel) {}
            Button(mail ? "Plaatsen en e-mailen" : "Plaatsen") { Task { await post() } }
        } message: {
            Text(mail ? "Dit bericht plaatsen in de apps én e-mailen naar alle gebruikers?" : "Dit bericht plaatsen in de apps?")
        }
        .alert("Bericht verwijderen", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), presenting: deleting) { a in
            Button("Annuleren", role: .cancel) {}
            Button("Verwijderen", role: .destructive) { Task { await delete(a) } }
        } message: { a in
            Text("\"\(a.titleNl)\" verwijderen? Apps tonen het dan niet meer.")
        }
    }

    // MARK: opstellen

    private var composeCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            CardHeader(title: "Nieuw bericht", subtitle: "Apps tonen een bericht één keer, zolang het actief is (max. 30 dagen).")
            GroupBox {
                VStack(alignment: .leading, spacing: 10) {
                    field("Titel", text: $titleNl, limit: 120)
                    editor("Tekst", text: $bodyNl)
                }
            } label: {
                Text("Nederlands").font(.subheadline.weight(.semibold))
            }
            .backgroundStyle(Color.surface2)
            GroupBox {
                VStack(alignment: .leading, spacing: 10) {
                    field("Title", text: $titleEn, limit: 120)
                    editor("Text", text: $bodyEn)
                }
            } label: {
                HStack(spacing: 6) {
                    Text("Engels").font(.subheadline.weight(.semibold))
                    Text("(leeg = Nederlands voor iedereen)").font(.caption).foregroundStyle(Color.textDim)
                }
            }
            .backgroundStyle(Color.surface2)

            Toggle("Verloopdatum", isOn: $hasExpiry)
            if hasExpiry {
                DatePicker("Verloopt op", selection: $expiry, in: Date()..., displayedComponents: .date)
                    .environment(\.locale, Fmt.nl)
            }
            Toggle("Ook per e-mail versturen", isOn: $mail)
                .disabled(!smtpOK)
            if !smtpOK {
                Text("E-mail is niet ingesteld (BINGR_SMTP_* ontbreken).").font(.caption).foregroundStyle(Color.textDim)
            }
            if !error.isEmpty {
                Text(error).font(.subheadline).foregroundStyle(Color.warn)
            }
            Button {
                validateAndConfirm()
            } label: {
                HStack {
                    if posting { ProgressView().tint(.white) }
                    Text(mail ? "Plaatsen en e-mailen" : "Plaatsen")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bingr)
            .disabled(posting || session.mailProgress.map { !$0.done } ?? false)

            if let p = session.mailProgress {
                VStack(alignment: .leading, spacing: 6) {
                    ProgressView(value: p.fraction).tint(.bingrRed)
                    Text(p.text).font(.caption).foregroundStyle(Color.textDim)
                }
            }
        }
        .card()
    }

    private func field(_ label: String, text: Binding<String>, limit: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(Color.textSecondary)
            TextField("", text: text)
                .fieldStyle()
                .onChange(of: text.wrappedValue) { _, v in
                    if v.count > limit { text.wrappedValue = String(v.prefix(limit)) }
                }
        }
    }

    private func editor(_ label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(Color.textSecondary)
            TextField("", text: text, axis: .vertical)
                .lineLimit(4...12)
                .fieldStyle()
                .onChange(of: text.wrappedValue) { _, v in
                    if v.count > 4000 { text.wrappedValue = String(v.prefix(4000)) }
                }
        }
    }

    // MARK: voorbeeld

    private var previewCard: some View {
        let en = previewLang == "en" && !trim(titleEn).isEmpty && !trim(bodyEn).isEmpty
        let title = trim(en ? titleEn : titleNl)
        let text = trim(en ? bodyEn : bodyNl)
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
            VStack(spacing: 14) {
                Text(title.isEmpty ? "Titel" : title).font(.title3.weight(.heavy)).multilineTextAlignment(.center)
                Text(text.isEmpty ? "Tekst van het bericht" : text)
                    .font(.subheadline).foregroundStyle(Color(hex: 0xD6D6D6)).multilineTextAlignment(.center)
                Text("OK").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 10)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.bingrRed))
            }
            .padding(20)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: 14).fill(Color(hex: 0x141414)))
            .overlay(alignment: .top) {
                UnevenRoundedRectangle(topLeadingRadius: 14, topTrailingRadius: 14).fill(Color.bingrRed).frame(height: 4)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 16).fill(Color.black.opacity(0.6)))
        }
        .card()
    }

    // MARK: lijst

    private var listCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "Geplaatste berichten")
            if loaded && items.isEmpty {
                EmptyText(text: "Nog geen berichten.")
            }
            ForEach(items) { a in
                AnnouncementRow(item: a, canResume: session.mailProgress.map { $0.done } ?? true,
                                resume: { Task { await sendMails(id: a.id, total: a.emailTotal) } },
                                delete: { deleting = a })
                if a.id != items.last?.id { Divider().overlay(Color.line) }
            }
        }
        .card()
    }

    // MARK: acties

    private func trim(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func validateAndConfirm() {
        error = ""
        if trim(titleNl).isEmpty || trim(bodyNl).isEmpty { error = APIError.text("text_missing"); return }
        if trim(titleEn).isEmpty != trim(bodyEn).isEmpty {
            error = "Vul bij Engels zowel titel als tekst in (of laat beide leeg)."
            return
        }
        confirmPost = true
    }

    private func post() async {
        posting = true
        defer { posting = false }
        var expires: String?
        if hasExpiry {
            let cal = Calendar.current
            let end = cal.date(bySettingHour: 23, minute: 59, second: 59, of: expiry) ?? expiry
            expires = ISO8601DateFormatter().string(from: end)
        }
        let withMail = mail && smtpOK
        do {
            let r = try await session.call("announce", [
                "title_nl": trim(titleNl), "body_nl": trim(bodyNl), "title_en": trim(titleEn), "body_en": trim(bodyEn),
                "email": withMail, "expires_at": expires,
            ])
            titleNl = ""; bodyNl = ""; titleEn = ""; bodyEn = ""; hasExpiry = false
            if withMail, let id = r["id"].text {
                mail = false
                await load()
                await sendMails(id: id, total: r["email_total"].int ?? 0)
            } else {
                session.show("Bericht geplaatst.")
            }
            await load()
        } catch let e as APIError {
            if e.code != "auth" { error = e.errorDescription ?? "" }
        } catch {}
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
            await load()
        } catch {
            session.report(error)
        }
    }

    private func load() async {
        do {
            let r = try await session.call("announcements_list")
            items = r["items"].array.map(Announcement.init)
            smtpOK = r["smtp"].bool != false
            if !smtpOK { mail = false }
            loaded = true
        } catch {
            session.report(error)
        }
    }
}

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
                Chip(text: item.active ? "Actief" : "Verlopen", tone: item.active ? .good : .neutral)
                Text(Fmt.dateTime(item.createdAt))
                if let exp = item.expiresAt { Text("· tot \(Fmt.date(exp))") }
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
