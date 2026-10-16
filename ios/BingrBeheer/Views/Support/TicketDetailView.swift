import SwiftUI

/// Een ticket (`support_get`): gegevens, account van de klant, gesprek met interne notities,
/// antwoord of notitie (`support_reply` / `support_note`) en status/prioriteit (`support_status`).
struct TicketDetailView: View {
    let number: Int
    let onChange: () async -> Void

    @Environment(Session.self) private var session
    @State private var ticket: TicketDetail?
    @State private var error: String?

    // antwoordvak
    @State private var kind = Kind.reply
    @State private var message = ""
    @State private var after = "pending"
    @State private var sending = false
    @State private var sendError = ""

    // status en prioriteit
    @State private var status = "new"
    @State private var priority = "normal"
    @State private var notify = true
    @State private var saving = false

    @FocusState private var composerFocused: Bool

    enum Kind: String { case reply, note }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let error, ticket == nil {
                    NoticeBanner(text: error)
                } else if ticket == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
                if let t = ticket {
                    header(t)
                    infoCard(t)
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Gesprek").font(.headline)
                        if t.messages.isEmpty { EmptyText(text: "Geen berichten.") }
                        ForEach(t.messages) { m in MessageBubble(message: m) }
                    }
                    composer(t)
                    statusCard(t)
                }
            }
            .padding(16)
            .frame(maxWidth: 860, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationTitle("#\(number)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let url = ticket?.customerURL {
                ToolbarItem(placement: .topBarTrailing) {
                    Link(destination: url) { Image(systemName: "arrow.up.right.square") }
                        .accessibilityLabel("Klantweergave openen")
                }
            }
        }
        .refreshableCommand { await load() }
        .task { if ticket == nil { await load() } }
    }

    // MARK: onderdelen

    private func header(_ t: TicketDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(t.subject).font(.title3.weight(.bold))
            HStack(spacing: 8) {
                TicketStatusBadge(status: t.status)
                if t.priority != "normal" {
                    Chip(text: Labels.priority(t.priority), tone: t.priority == "low" ? .neutral : .bad)
                }
                Text("Aangemaakt \(Fmt.dateTime(t.createdAt))").font(.caption).foregroundStyle(Color.textDim)
            }
        }
    }

    private func infoCard(_ t: TicketDetail) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            InfoRow(label: "Klant") {
                VStack(alignment: .leading, spacing: 2) {
                    Text(t.name ?? "—")
                    if let mail = URL(string: "mailto:\(t.email)") {
                        Link(t.email, destination: mail)
                    } else {
                        Text(t.email)
                    }
                }
            }
            InfoRow(label: "Account") {
                if let a = t.account {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(a.linked ? "Gekoppeld" : "Gevonden op e-mailadres") · \(Fmt.plural(a.deviceCount, "apparaat", "apparaten"))"
                             + (a.platforms.isEmpty ? "" : " · " + a.platforms.map { Labels.platform($0) }.joined(separator: ", ")))
                        if !a.appVersions.isEmpty {
                            Text("Versies: \(a.appVersions.joined(separator: ", "))").font(.caption).foregroundStyle(Color.textDim)
                        }
                        Text("Account sinds \(Fmt.date(a.createdAt))"
                             + (a.lastSeenAt.map { " · laatst gezien \(Fmt.ago($0))" } ?? "")
                             + (a.confirmed ? "" : " · onbevestigd")
                             + " · \(Fmt.num(a.tickets)) ticket(s)")
                            .font(.caption).foregroundStyle(Color.textDim)
                    }
                } else {
                    Text("Geen Bingr-account met dit adres")
                }
            }
            InfoRow("Categorie", [Labels.category(t.category), t.platform.map { Labels.supportPlatform($0) },
                                  t.appVersion.map { "Bingr \($0)" }].compactMap { $0 }.joined(separator: " · "))
            if t.deviceName != nil || t.osVersion != nil {
                InfoRow("Apparaat", [t.deviceName, t.osVersion].compactMap { $0 }.joined(separator: " · "))
            }
            InfoRow(label: "Taal") {
                HStack(spacing: 8) {
                    Text(t.lang == "en" ? "Engels" : "Nederlands")
                    if let url = t.customerURL {
                        Link("Klantweergave openen ↗", destination: url).font(.caption)
                    }
                }
            }
        }
        .card()
    }

    private func composer(_ t: TicketDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Soort bericht", selection: $kind) {
                Text("Antwoord aan klant").tag(Kind.reply)
                Text("Interne notitie").tag(Kind.note)
            }
            .pickerStyle(.segmented)

            TextField(kind == .note ? "Alleen zichtbaar in het beheer…" : "Typ je antwoord aan \(t.name ?? "de klant")…",
                      text: $message, axis: .vertical)
                .lineLimit(5...14)
                .focused($composerFocused)
                .fieldStyle()
                .onChange(of: message) { _, v in
                    if v.count > 5000 { message = String(v.prefix(5000)) }
                }

            HStack(spacing: 12) {
                if kind == .reply {
                    Picker("Status na verzenden", selection: $after) {
                        Text("Wacht op klant").tag("pending")
                        Text("In behandeling").tag("open")
                        Text("Opgelost").tag("resolved")
                        Text("Gesloten").tag("closed")
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                    Text("na verzenden").font(.caption).foregroundStyle(Color.textDim)
                }
                Spacer()
                Button {
                    Task { await send(t) }
                } label: {
                    HStack(spacing: 6) {
                        if sending { ProgressView().tint(.white) }
                        Text(kind == .note ? "Notitie opslaan" : "Versturen")
                    }
                }
                .buttonStyle(.bingr)
                .disabled(sending)
            }

            if kind == .reply {
                Text("De klant krijgt een mail vanaf support@bingr.online met #\(t.number) in het onderwerp\(t.lang == "en" ? " (in het Engels)" : "").")
                    .font(.caption).foregroundStyle(Color.textDim)
                if t.smtp == false {
                    Text("Let op: e-mail is niet ingesteld.").font(.caption.weight(.bold)).foregroundStyle(Color.warn)
                }
            }
            if !sendError.isEmpty {
                Text(sendError).font(.subheadline).foregroundStyle(Color.warn)
            }
        }
        .card(highlight: kind == .note ? Color.stateDegraded : nil)
    }

    private func statusCard(_ t: TicketDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Status").foregroundStyle(Color.textSecondary)
                Spacer()
                Picker("Status", selection: $status) {
                    ForEach(Labels.ticketStatus, id: \.key) { s in Text(s.label).tag(s.key) }
                }
                .pickerStyle(.menu)
            }
            HStack {
                Text("Prioriteit").foregroundStyle(Color.textSecondary)
                Spacer()
                Picker("Prioriteit", selection: $priority) {
                    ForEach(Labels.priorities, id: \.key) { p in Text(p.label).tag(p.key) }
                }
                .pickerStyle(.menu)
            }
            Toggle("Klant mailen bij opgelost of gesloten", isOn: $notify)
            Button {
                Task { await saveStatus(t) }
            } label: {
                HStack(spacing: 6) {
                    if saving { ProgressView().tint(.white) }
                    Text("Opslaan")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bingrGhost)
            .disabled(saving)
        }
        .font(.subheadline)
        .card()
    }

    // MARK: acties

    private func load() async {
        do {
            let t = TicketDetail(try await session.call("support_get", ["number": number]))
            ticket = t
            status = t.status
            priority = t.priority
            error = nil
            // support_get zet het ticket op gelezen: badge bijwerken
            await session.refreshSupportCounts()
        } catch {
            if error is CancellationError { return }
            self.error = (error as? APIError)?.errorDescription ?? APIError.text("server_error")
        }
    }

    private func send(_ t: TicketDetail) async {
        let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { sendError = APIError.text("message_missing"); return }
        sending = true
        sendError = ""
        defer { sending = false }
        do {
            if kind == .note {
                try await session.call("support_note", ["number": t.number, "message": text])
                session.show("Notitie opgeslagen.")
            } else {
                let x = try await session.call("support_reply", ["number": t.number, "message": text, "status": after])
                if x["email_sent"].bool == true {
                    session.show("Antwoord verstuurd naar \(t.email).")
                } else {
                    let why = x["email_error"].text.map { " (\($0))" } ?? ""
                    session.show("Antwoord opgeslagen, maar de mail is niet verstuurd\(why).", bad: true)
                }
            }
            message = ""
            composerFocused = false
            await load()
            await onChange()
        } catch let e as APIError {
            if e.code != "auth" { sendError = e.errorDescription ?? "" }
        } catch {}
    }

    private func saveStatus(_ t: TicketDetail) async {
        if status == t.status && priority == t.priority {
            session.show("Niets gewijzigd.")
            return
        }
        saving = true
        defer { saving = false }
        do {
            let x = try await session.call("support_status", [
                "number": t.number,
                "status": status != t.status ? status : nil,
                "priority": priority != t.priority ? priority : nil,
                "notify": notify,
            ])
            switch x["email_sent"].bool {
            case true?: session.show("Opgeslagen; de klant is gemaild.")
            case false?: session.show("Opgeslagen, maar de mail is niet verstuurd.", bad: true)
            case nil: session.show("Opgeslagen.")
            }
            await load()
            await onChange()
        } catch {
            session.report(error)
        }
    }
}

/// Bericht in het gesprek: klant links, support rechts, interne notitie geel, statuswijziging in het midden.
struct MessageBubble: View {
    let message: TicketDetail.Message

    var body: some View {
        let m = message
        if m.author == "event" {
            HStack {
                Spacer()
                Text("Status: **\(Labels.ticketStatus(m.body))** · \(Fmt.dateTime(m.createdAt))")
                    .font(.caption).foregroundStyle(Color.textDim)
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .background(Capsule().fill(Color.white.opacity(0.06)))
                Spacer()
            }
        } else {
            let isSupport = m.author == "support"
            let isNote = m.author == "note"
            HStack {
                if isSupport || isNote { Spacer(minLength: 40) }
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Text(isSupport ? "Bingr Support" : isNote ? "Interne notitie" : m.author == "customer" ? "Klant" : m.author)
                            .font(.caption.weight(.bold))
                        Text(Fmt.dateTime(m.createdAt)).font(.caption2).foregroundStyle(Color.textDim)
                    }
                    HStack(spacing: 4) {
                        if m.source == "email" { Chip(text: "per e-mail", icon: "envelope") }
                        if isSupport {
                            if m.emailSent == true { Chip(text: "gemaild") } else { Chip(text: "niet gemaild", tone: .warn) }
                        }
                    }
                    Text(m.body).font(.subheadline).textSelection(.enabled)
                    if isSupport, m.emailSent != true, let e = m.emailError {
                        Text(e).font(.caption2).foregroundStyle(Color.warn)
                    }
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(
                    isNote ? Color.stateDegraded.opacity(0.12) : isSupport ? Color.bingrRed.opacity(0.14) : Color.surface2))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(
                    isNote ? Color.stateDegraded.opacity(0.4) : isSupport ? Color.bingrRed.opacity(0.35) : Color.white.opacity(0.08)))
                if !(isSupport || isNote) { Spacer(minLength: 40) }
            }
        }
    }
}
