import SwiftUI

/// Tab Support: inbox-import, filters met aantallen, zoeken en de ticketlijst (`support_list`).
struct SupportView: View {
    @Environment(Session.self) private var session
    @AppStorage("supportFilter") private var filter = "active"
    @State private var query = ""
    @State private var items: [TicketRow] = []
    @State private var total = 0
    @State private var page = 0
    @State private var loading = false
    @State private var loaded = false
    @State private var error: String?
    @State private var smtpMissing = false
    @State private var inbox: InboxStatus?
    @State private var inboxError: String?
    @State private var polling = false

    private let pageSize = 50

    var body: some View {
        List {
            Section {
                if smtpMissing {
                    NoticeBanner(text: "E-mail is niet ingesteld (BINGR_SMTP_*): tickets komen binnen, maar klanten en support@bingr.online krijgen geen mail.")
                        .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                        .listRowBackground(Color.clear)
                }
                InboxStatusCard(inbox: inbox, error: inboxError, polling: polling) { Task { await poll() } } openTicket: { n in
                    session.supportPath.append(n)
                }
                .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                .listRowBackground(Color.clear)
                filterBar
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                    .listRowBackground(Color.clear)
            }
            .listRowSeparator(.hidden)

            Section {
                if let error {
                    Text(error).foregroundStyle(Color.warn).listRowBackground(Color.surface1)
                }
                ForEach(items) { t in
                    NavigationLink(value: t.number) {
                        TicketRowView(ticket: t)
                    }
                    .listRowBackground(Color.surface1)
                    .onAppear {
                        if t.id == items.last?.id { Task { await loadMore() } }
                    }
                }
                if loaded && items.isEmpty && error == nil {
                    EmptyText(text: !query.trimmingCharacters(in: .whitespaces).isEmpty ? "Geen tickets gevonden."
                              : filter == "active" ? "Geen open tickets. Alles is beantwoord." : "Geen tickets.")
                        .listRowBackground(Color.surface1)
                }
                if loading {
                    HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
                }
            } footer: {
                if loaded && total > 0 {
                    Text(Fmt.plural(total, "ticket", "tickets")).font(.caption).foregroundStyle(Color.textDim)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .screenBackground()
        .navigationTitle("Support")
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Zoek op #nummer, onderwerp, naam of e-mail")
        .autocorrectionDisabled()
        .navigationDestination(for: Int.self) { n in
            TicketDetailView(number: n) { await reloadAll() }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Link(destination: Config.supportSite) { Image(systemName: "safari") }
                    .accessibilityLabel("Supportsite")
            }
        }
        .refreshableCommand { await reloadAll() }
        .task(id: "\(filter)|\(query)") {
            if loaded { try? await Task.sleep(for: .milliseconds(300)) }
            if Task.isCancelled { return }
            await reloadAll()
        }
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Labels.supportFilters, id: \.key) { f in
                    let on = f.key == filter
                    Button {
                        filter = f.key
                    } label: {
                        HStack(spacing: 6) {
                            Text(f.label)
                            if let n = session.supportCounts?.count(for: f.key) {
                                Text(Fmt.num(n))
                                    .font(.caption.weight(.bold))
                                    .padding(.horizontal, 6)
                                    .background(Capsule().fill(on ? Color.white.opacity(0.25) : Color.white.opacity(0.1)))
                            }
                        }
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .foregroundStyle(on ? Color.white : Color.textSecondary)
                        .background(Capsule().fill(on ? Color.bingrRed : Color.surface2))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            .padding(.horizontal, 16)
        }
    }

    // MARK: laden

    private func reloadAll() async {
        async let i: Void = loadInbox()
        await fetch(page: 0, replace: true)
        await i
    }

    private func loadMore() async {
        guard !loading, items.count < total else { return }
        await fetch(page: page + 1, replace: false)
    }

    private func fetch(page p: Int, replace: Bool) async {
        loading = true
        defer { loading = false }
        do {
            let r = try await session.call("support_list", [
                "status": filter, "q": query.trimmingCharacters(in: .whitespaces), "page": p, "page_size": pageSize,
            ])
            let rows = r["items"].array.map(TicketRow.init)
            total = r["total"].int ?? 0
            page = p
            if replace { items = rows } else { items += rows.filter { n in !items.contains { $0.number == n.number } } }
            if r["counts"].object != nil {
                let counts = SupportCounts(r["counts"])
                if counts != session.supportCounts {
                    session.supportCounts = counts
                    // widgets met de supporttellers meteen bijwerken
                    session.reloadWidgets(WidgetShared.supportKind)
                }
            }
            smtpMissing = r["smtp"].bool == false
            error = nil
            loaded = true
        } catch {
            if error is CancellationError { return }
            self.error = (error as? APIError)?.errorDescription ?? APIError.text("server_error")
            if replace { items = [] }
            loaded = true
        }
    }

    private func loadInbox() async {
        do {
            inbox = InboxStatus(try await session.call("support_inbox"))
            inboxError = nil
        } catch {
            if error is CancellationError { return }
            inboxError = (error as? APIError)?.errorDescription
        }
    }

    /// "Nu ophalen": inbox-import direct draaien (`support_poll`).
    private func poll() async {
        polling = true
        defer { polling = false }
        do {
            let x = try await session.call("support_poll")
            if x["busy"].bool == true {
                session.show("Er loopt al een ronde; probeer het zo opnieuw.")
            } else if !x["skipped"].isNull {
                session.show("IMAP is niet ingesteld.", bad: true)
            } else if x["ok"].bool == false {
                session.show("Ophalen mislukt: \(x["error"].text ?? "onbekende fout")", bad: true)
            } else {
                let imported = x["imported"].int ?? 0, agent = x["agent"].int ?? 0, new = x["new_tickets"].int ?? 0
                let n = imported + agent + new
                session.show(n > 0
                    ? "\(n) mail\(n == 1 ? "" : "s") verwerkt (\(imported) reactie\(imported == 1 ? "" : "s"), \(agent) antwoord\(agent == 1 ? "" : "en") support, \(new) nieuw)."
                    : "Geen nieuwe mails voor tickets (\(x["fetched"].int ?? 0) bekeken).")
            }
        } catch {
            session.report(error)
        }
        await reloadAll()
        await session.refreshSupportCounts()
    }
}

/// Rij in de ticketlijst.
struct TicketRowView: View {
    let ticket: TicketRow

    var body: some View {
        let t = ticket
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                if t.unread {
                    Circle().fill(Color.bingrRed).frame(width: 8, height: 8).accessibilityLabel("Klant wacht op reactie")
                }
                Text("#\(t.number)").font(.subheadline.weight(.bold)).monospacedDigit()
                    .foregroundStyle(t.unread ? Color.white : Color.textSecondary)
                Spacer()
                TicketStatusBadge(status: t.status)
            }
            Text(t.subject).font(.body.weight(t.unread ? .bold : .semibold)).lineLimit(2)
            HStack(spacing: 4) {
                Text([t.name, t.email].compactMap { $0 }.joined(separator: " · ")).lineLimit(1)
                if t.hasAccount { Chip(text: "account") }
                if t.priority == "high" || t.priority == "urgent" { Chip(text: Labels.priority(t.priority), tone: .bad) }
            }
            .font(.caption).foregroundStyle(Color.textDim)
            HStack(spacing: 4) {
                Text(Labels.category(t.category))
                if let p = t.platform { Chip(text: Labels.supportPlatform(p)) }
                if t.source == "app" { Chip(text: "app", icon: "app") }
                Spacer()
                Text(Fmt.ago(t.lastReplyAt))
            }
            .font(.caption).foregroundStyle(Color.textSecondary)
        }
        .padding(.vertical, 4)
    }
}

/// Statusregel van de inbox-import met "Nu ophalen" en het logboek van de laatste mails.
struct InboxStatusCard: View {
    let inbox: InboxStatus?
    let error: String?
    let polling: Bool
    let poll: () -> Void
    let openTicket: (Int) -> Void
    @State private var showLog = false

    var body: some View {
        if let error {
            row(tone: .warn, text: Text("E-mail-inbox: \(error)"))
        } else if let r = inbox {
            VStack(alignment: .leading, spacing: 10) {
                if !r.configured {
                    row(tone: .neutral, text: Text("E-mail-inbox: **IMAP niet ingesteld**. Antwoorden per e-mail komen niet in de tickets en meldingen hebben de klant als Reply-To. Zet de secrets BINGR_IMAP_HOST, BINGR_IMAP_USER en BINGR_IMAP_PASSWORD (en BINGR_SUPPORT_AGENTS) in iptv-ios-appletv en draai de workflow Backend."))
                } else {
                    row(tone: r.failed || r.stale ? .warn : .good, text: summary(r))
                    HStack {
                        Button {
                            poll()
                        } label: {
                            HStack(spacing: 6) {
                                if polling { ProgressView().controlSize(.small).tint(.white) }
                                Text(polling ? "Ophalen…" : "Nu ophalen")
                            }
                        }
                        .buttonStyle(.bingrGhost)
                        .controlSize(.small)
                        .disabled(polling)
                        Spacer()
                    }
                }
                if !r.log.isEmpty {
                    DisclosureGroup(isExpanded: $showLog) {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(r.log) { x in logRow(x) }
                        }
                        .padding(.top, 6)
                    } label: {
                        Text("Laatste mails in support@ (\(r.log.count))").font(.subheadline)
                    }
                }
            }
            .card(padding: 12)
        }
    }

    private func row(tone: Tone, text: Text) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Circle().fill(tone == .neutral ? Color.textDim : Color.tone(tone)).frame(width: 9, height: 9).padding(.top, 5)
            text.font(.subheadline).foregroundStyle(Color.textSecondary)
        }
    }

    private func summary(_ r: InboxStatus) -> Text {
        var parts: [String] = ["laatst opgehaald **\(r.lastPollAt.map { Fmt.ago($0) } ?? "nog nooit")**"]
        if let i = r.lastImportAt { parts.append("laatste import \(Fmt.ago(i))") }
        if !r.failed && r.lastOkAt != nil {
            parts.append("laatste ronde: \(Fmt.num(r.lastFetched)) mail\(r.lastFetched == 1 ? "" : "s")\(r.more ? ", er staan er nog meer klaar" : "")")
        }
        if !r.extraAgents { parts.append("alleen antwoorden vanaf het supportadres zelf (BINGR_SUPPORT_AGENTS niet gezet)") }
        if r.failed { parts.append("fout: \(r.lastError ?? "")") } else if r.stale { parts.append("de planning (elke 2 min) lijkt niet te lopen") }
        let head = "E-mail-inbox\(r.user.map { " (\($0))" } ?? ""): "
        return Text(LocalizedStringKey(head + parts.joined(separator: " · ")))
    }

    private func logRow(_ x: InboxStatus.LogItem) -> some View {
        let (label, tone) = Labels.inboxResult(x.result)
        return VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(Fmt.dateTime(x.at)).font(.caption2).foregroundStyle(Color.textDim)
                Spacer()
                Text(label).font(.caption2.weight(.semibold)).foregroundStyle(Color.tone(tone))
                if let n = x.ticketNumber {
                    Button("#\(n)") { openTicket(n) }.font(.caption2.weight(.bold)).buttonStyle(.borderless)
                }
            }
            Text(x.subject ?? "(geen onderwerp)").font(.caption).lineLimit(1)
            if let s = x.sender { Text(s).font(.caption2).foregroundStyle(Color.textDim).lineLimit(1) }
            if let d = x.detail { Text(d).font(.caption2).foregroundStyle(Color.textDim).lineLimit(2) }
        }
    }
}
