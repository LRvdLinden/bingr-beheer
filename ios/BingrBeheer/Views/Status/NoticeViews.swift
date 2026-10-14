import SwiftUI

// Meldingen op bingr.online/status: storingen en gepland onderhoud (`status` met op `notice_save` / `notice_update` /
// `notice_delete`), zelfde werking als de meldingen in het web-dashboard (web/admin.js).

struct NoticeEditTarget: Identifiable {
    let id = UUID()
    let kind: String
    let notice: StatusNotice?
}

/// Status van een melding als label.
struct NoticeStatusChip: View {
    let status: String

    var body: some View {
        Chip(text: Labels.noticeStatus(status), tone: tone)
    }

    private var tone: Tone {
        switch status {
        case "resolved", "completed": return .good
        case "investigating", "identified": return .bad
        case "monitoring", "scheduled", "in_progress": return .warn
        default: return .neutral
        }
    }
}

/// Rij van een melding in de lijst (zoals .nt-row).
struct NoticeRowView: View {
    let notice: StatusNotice
    let monitorName: (String) -> String

    var body: some View {
        let n = notice
        HStack(alignment: .top, spacing: 10) {
            RoundedRectangle(cornerRadius: 2).fill(n.toneColor).frame(width: 4, height: 38)
            VStack(alignment: .leading, spacing: 3) {
                Text(n.titleNl).font(.subheadline.weight(.bold)).lineLimit(2)
                Text(subtitle).font(.caption).foregroundStyle(Color.textDim).lineLimit(2)
                if n.auto || !n.notify {
                    HStack(spacing: 4) {
                        if n.auto { Chip(text: "automatisch") }
                        if !n.notify { Chip(text: "geen mail") }
                    }
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 3) {
                NoticeStatusChip(status: n.status)
                Text(when).font(.caption).foregroundStyle(Color.textDim).multilineTextAlignment(.trailing)
            }
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(Color.textDim).padding(.top, 4)
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }

    private var subtitle: String {
        let n = notice
        var s = n.isMaintenance ? "Onderhoud" : "Storing · impact \(Labels.impact(n.impact))"
        if !n.components.isEmpty { s += " · " + n.components.map { monitorName($0.id) }.joined(separator: ", ") }
        return s
    }

    private var when: String {
        let n = notice
        if n.isMaintenance, let ws = n.windowStart {
            return "\(Fmt.dateTime(ws)) – \(Fmt.time(n.windowEnd))"
        }
        let start = n.startedAt ?? Date()
        if let r = n.resolvedAt {
            return "\(Fmt.dateTime(n.startedAt)) · \(Fmt.duration(seconds: Int(r.timeIntervalSince(start))))"
        }
        return "\(Fmt.dateTime(n.startedAt)) · loopt \(Fmt.duration(seconds: Int(Date().timeIntervalSince(start))))"
    }
}

/// Getroffen onderdelen kiezen, per groep; bij storingen met impact per onderdeel (zoals compPicker in web/admin.js).
/// `selection`: monitor-id -> impact.
struct NoticeComponentPicker: View {
    let groups: [StatusOverview.Group]
    let withImpact: Bool
    @Binding var selection: [String: String]

    var body: some View {
        if groups.isEmpty {
            Section("Getroffen onderdelen") { EmptyText(text: "Geen monitors gevonden.") }
        }
        ForEach(groups) { g in
            Section("Getroffen onderdelen · \(g.name)") {
                ForEach(g.monitors) { m in
                    Toggle(isOn: isOn(m.id)) {
                        HStack(spacing: 6) {
                            Text(m.nameNl)
                            if !m.isPublic { Chip(text: "niet openbaar") }
                        }
                    }
                    .tint(.bingrRed)
                    if withImpact && selection[m.id] != nil {
                        Picker("Impact op \(m.nameNl)", selection: impact(m.id)) {
                            ForEach(Labels.componentImpacts, id: \.key) { o in Text(o.label).tag(o.key) }
                        }
                    }
                }
            }
        }
    }

    private func isOn(_ id: String) -> Binding<Bool> {
        Binding(get: { selection[id] != nil }, set: { on in selection[id] = on ? (selection[id] ?? "major") : nil })
    }

    private func impact(_ id: String) -> Binding<String> {
        Binding(get: { selection[id] ?? "major" }, set: { selection[id] = $0 })
    }

    /// Voor de API: [{id, impact}] (bij onderhoud negeert de functie de impact).
    static func payload(_ selection: [String: String]) -> [[String: String]] {
        selection.keys.sorted().map { ["id": $0, "impact": selection[$0] ?? "major"] }
    }

    /// Namen (NL, EN) van de gekozen onderdelen, voor de standaardteksten.
    static func names(_ ids: [String], overview: StatusOverview?) -> (String, String) {
        let ms = ids.map { id in overview?.allMonitors.first { $0.id == id } }
        let nl = zip(ids, ms).map { $1?.nameNl ?? $0 }.joined(separator: ", ")
        let en = zip(ids, ms).map { $1?.nameEn ?? $0 }.joined(separator: ", ")
        return (nl, en)
    }

    static func toast(_ prefix: String, _ r: JSON) -> String {
        guard r["queued"].bool == true else { return prefix + "." }
        let sent = r["mailed"]["sent"].int ?? 0
        return prefix + (sent > 0 ? ", \(sent) mail(s) verstuurd." : ", mail staat in de wachtrij.")
    }
}

/// Nieuwe storing melden, onderhoud plannen, of titel, impact, onderdelen en tijdvak wijzigen (`notice_save`).
struct NoticeEditView: View {
    let kind: String
    let notice: StatusNotice?
    let overview: StatusOverview?
    let onSaved: () async -> Void

    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var titleNl = ""
    @State private var titleEn = ""
    @State private var impact = "minor"
    @State private var status = "investigating"
    @State private var windowStart: Date
    @State private var windowEnd: Date
    @State private var comps: [String: String] = [:]
    @State private var messageNl = ""
    @State private var messageEn = ""
    @State private var notify = true
    @State private var autoResolve = false
    @State private var error: String?
    @State private var saving = false

    init(kind: String, notice: StatusNotice?, overview: StatusOverview?, onSaved: @escaping () async -> Void) {
        self.kind = kind
        self.notice = notice
        self.overview = overview
        self.onSaved = onSaved
        // standaard: morgen 01:00 UTC, één uur (zoals het web-dashboard)
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC") ?? .current
        let start = notice?.windowStart ?? utc.startOfDay(for: Date().addingTimeInterval(86400)).addingTimeInterval(3600)
        _windowStart = State(initialValue: start)
        _windowEnd = State(initialValue: notice?.windowEnd ?? start.addingTimeInterval(3600))
    }

    private var isNew: Bool { notice == nil }
    private var isMaintenance: Bool { kind == "maintenance" }

    var body: some View {
        Form {
            Section {
                Text(isNew
                     ? "Komt meteen op bingr.online/status en (als je dat aanzet) per e-mail naar de abonnees."
                     : "Wijzigt alleen de gegevens; een update in de tijdlijn plaats je vanuit de melding zelf. Hier gaat geen mail uit.")
                    .font(.subheadline).foregroundStyle(Color.textSecondary)
            }
            Section("Titel") {
                TextField("Titel (Nederlands)", text: $titleNl)
                TextField("Titel (Engels)", text: $titleEn)
            }
            if isMaintenance {
                Section("Tijdvak") {
                    DatePicker("Begin", selection: $windowStart)
                    DatePicker("Einde", selection: $windowEnd, in: windowStart...)
                }
                .environment(\.locale, Fmt.nl)
            } else {
                Section {
                    Picker("Impact", selection: $impact) {
                        ForEach(Labels.impacts, id: \.key) { o in Text(o.label).tag(o.key) }
                    }
                    if isNew {
                        Picker("Status", selection: $status) {
                            ForEach(Labels.incidentStatuses.prefix(3), id: \.self) { k in Text(Labels.noticeStatus(k)).tag(k) }
                        }
                    }
                }
            }
            NoticeComponentPicker(groups: overview?.noticeGroups ?? [], withImpact: !isMaintenance, selection: $comps)
            if isNew {
                Section {
                    TextField("Bericht (Nederlands)", text: $messageNl, axis: .vertical).lineLimit(3...10)
                    TextField("Bericht (Engels, leeg = Nederlands)", text: $messageEn, axis: .vertical).lineLimit(3...10)
                    Button("Standaardtekst invullen") { fillTemplate() }
                } header: {
                    Text("Eerste update in de tijdlijn")
                }
            }
            Section {
                Toggle(overview?.subscribersConfirmed.map { "Abonnees mailen (\(Fmt.num($0)))" } ?? "Abonnees mailen", isOn: $notify)
                    .tint(.bingrRed)
                if !isMaintenance, let n = notice, n.auto {
                    Toggle("Vanzelf oplossen als de monitoring weer groen is", isOn: $autoResolve).tint(.bingrRed)
                }
            }
            if let error {
                Section { Text(error).foregroundStyle(Color.warn) }
            }
        }
        .scrollContentBackground(.hidden)
        .screenBackground()
        .navigationTitle(isNew ? (isMaintenance ? "Onderhoud plannen" : "Storing melden") : "Melding bewerken")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Annuleren") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                if saving {
                    ProgressView()
                } else {
                    Button(isNew ? (isMaintenance ? "Plannen" : "Plaatsen") : "Opslaan") { Task { await save() } }
                }
            }
        }
        .onAppear(perform: fill)
    }

    private func fill() {
        guard let n = notice else { return }
        titleNl = n.titleNl
        titleEn = n.titleEn != n.titleNl ? n.titleEn : ""
        impact = Labels.impacts.contains { $0.key == n.impact } ? n.impact : "minor"
        comps = Dictionary(n.components.map { ($0.id, $0.impact) }, uniquingKeysWith: { a, _ in a })
        notify = n.notify
        autoResolve = n.autoResolve
    }

    private func fillTemplate() {
        let (nl, en) = NoticeComponentPicker.names(comps.keys.sorted(), overview: overview)
        guard let t = Labels.noticeTemplate(isMaintenance ? "scheduled" : status, nl: nl, en: en) else { return }
        messageNl = t.0
        messageEn = t.1
    }

    private func save() async {
        let tNl = titleNl.trimmingCharacters(in: .whitespacesAndNewlines)
        let mNl = messageNl.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !tNl.isEmpty else { error = APIError.text("title_missing"); return }
        if isNew && mNl.isEmpty { error = APIError.text("notice_message_missing"); return }
        if isMaintenance && (windowEnd <= windowStart || windowEnd.timeIntervalSince(windowStart) > 31 * 86400) {
            error = APIError.text("bad_window"); return
        }
        var params: [String: Any?] = [
            "op": "notice_save", "id": notice?.id, "kind": kind,
            "title_nl": String(tNl.prefix(140)), "title_en": String(titleEn.trimmingCharacters(in: .whitespacesAndNewlines).prefix(140)),
            "components": NoticeComponentPicker.payload(comps), "notify": notify,
        ]
        if isMaintenance {
            let iso = ISO8601DateFormatter()
            params["window_start"] = iso.string(from: windowStart)
            params["window_end"] = iso.string(from: windowEnd)
        } else {
            params["impact"] = impact
            if isNew { params["status"] = status }
            if notice?.auto == true { params["auto_resolve"] = autoResolve }
        }
        if isNew {
            params["message_nl"] = String(mNl.prefix(4000))
            params["message_en"] = String(messageEn.trimmingCharacters(in: .whitespacesAndNewlines).prefix(4000))
        }
        saving = true
        error = nil
        defer { saving = false }
        do {
            let r = try await session.call("status", params)
            session.show(isNew ? NoticeComponentPicker.toast("Melding geplaatst", r) : "Melding opgeslagen.")
            await onSaved()
            dismiss()
        } catch {
            if error is CancellationError { return }
            if let e = error as? APIError, e.code == "auth" { dismiss(); return }
            self.error = (error as? APIError)?.errorDescription ?? APIError.text("server_error")
        }
    }
}

/// Eén melding: gegevens, update plaatsen (status + bericht), tijdlijn, bewerken en verwijderen.
struct NoticeDetailView: View {
    let noticeID: Int
    let initial: StatusNotice
    @Binding var overview: StatusOverview?
    let reload: () async -> Void

    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var updStatus = ""
    @State private var messageNl = ""
    @State private var messageEn = ""
    @State private var notify = true
    @State private var editComps = false
    @State private var comps: [String: String] = [:]
    @State private var error: String?
    @State private var sending = false
    @State private var editing: NoticeEditTarget?
    @State private var confirmDelete = false

    private var notice: StatusNotice { overview?.notice(noticeID) ?? initial }

    var body: some View {
        let n = notice
        Form {
            Section {
                VStack(alignment: .leading, spacing: 2) {
                    Text(n.titleNl).font(.headline)
                    if n.titleEn != n.titleNl { Text(n.titleEn).font(.caption).foregroundStyle(Color.textDim) }
                }
                InfoRow(label: "Soort") {
                    HStack(spacing: 6) {
                        Text(n.isMaintenance ? "Gepland onderhoud" : "Storing · impact \(Labels.impact(n.impact))")
                        if n.auto { Chip(text: "automatisch") }
                    }
                }
                InfoRow(label: "Status") { NoticeStatusChip(status: n.status) }
                if n.isMaintenance {
                    InfoRow("Tijdvak", "\(Fmt.dateTime(n.windowStart)) – \(Fmt.dateTime(n.windowEnd))")
                } else {
                    InfoRow("Begonnen", Fmt.dateTime(n.startedAt))
                }
                if let r = n.resolvedAt {
                    InfoRow(n.isMaintenance ? "Afgerond" : "Opgelost", Fmt.dateTime(r)
                        + (n.isMaintenance ? "" : " · " + Fmt.duration(seconds: Int(r.timeIntervalSince(n.startedAt ?? r)))))
                }
                InfoRow("Onderdelen", n.components.isEmpty ? "—" : n.components.map { c in
                    (overview?.monitorName(c.id) ?? c.id) + (n.isMaintenance ? "" : " (\(Labels.componentImpact(c.impact)))")
                }.joined(separator: ", "))
                InfoRow("E-mail", (n.notify ? "abonnees krijgen elke update" : "uit voor deze melding")
                    + (!n.isMaintenance && n.auto ? (n.autoResolve ? " · sluit vanzelf als alles weer werkt" : " · sluit niet vanzelf") : ""))
                if let url = URL(string: "https://bingr.online/status/incident/?id=\(n.id)") {
                    InfoRow(label: "Openbaar") { Link("bingr.online/status/incident/?id=\(n.id)", destination: url) }
                }
            }

            Section {
                Picker("Status", selection: $updStatus) {
                    ForEach(n.isMaintenance ? Labels.maintenanceStatuses : Labels.incidentStatuses, id: \.self) { k in
                        Text(Labels.noticeStatus(k)).tag(k)
                    }
                }
                TextField("Bericht (Nederlands)", text: $messageNl, axis: .vertical).lineLimit(3...10)
                TextField("Bericht (Engels, leeg = Nederlands)", text: $messageEn, axis: .vertical).lineLimit(3...10)
                Button("Standaardtekst voor deze status") { fillTemplate() }
                if !n.isMaintenance {
                    Toggle("Onderdelen en impact aanpassen", isOn: $editComps).tint(.bingrRed)
                }
                Toggle(n.notify ? "Abonnees mailen" : "Abonnees mailen (uit voor deze melding)", isOn: $notify)
                    .tint(.bingrRed)
                    .disabled(!n.notify)
                if let error { Text(error).foregroundStyle(Color.warn) }
                Button {
                    Task { await postUpdate() }
                } label: {
                    if sending { ProgressView() } else { Text("Update plaatsen").frame(maxWidth: .infinity) }
                }
                .buttonStyle(.bingr)
                .disabled(sending)
                .listRowBackground(Color.clear)
            } header: {
                Text("Update plaatsen")
            }

            if editComps && !n.isMaintenance {
                NoticeComponentPicker(groups: overview?.noticeGroups ?? [], withImpact: true, selection: $comps)
            }

            Section("Tijdlijn") {
                if n.updates.isEmpty { EmptyText(text: "Nog geen updates.") }
                ForEach(n.updates) { u in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(Labels.noticeStatus(u.status)).font(.subheadline.weight(.bold))
                            Spacer()
                            Text(Fmt.dateTime(u.at)).font(.caption).foregroundStyle(Color.textDim)
                        }
                        Text(u.bodyNl).font(.subheadline)
                        if !u.bodyEn.isEmpty && u.bodyEn != u.bodyNl {
                            Text(u.bodyEn).font(.caption).foregroundStyle(Color.textDim)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }

            Section {
                Button("Bewerken") { editing = NoticeEditTarget(kind: n.kind, notice: n) }
                Button("Verwijderen", role: .destructive) { confirmDelete = true }
            }
        }
        .scrollContentBackground(.hidden)
        .screenBackground()
        .navigationTitle(n.isMaintenance ? "Onderhoud" : "Storing")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $editing) { t in
            NavigationStack {
                NoticeEditView(kind: t.kind, notice: t.notice, overview: overview) {
                    await reload()
                }
            }
        }
        .confirmationDialog("\"\(n.titleNl)\" verwijderen? Hij verdwijnt van de statuspagina en uit de geschiedenis (er gaat geen mail uit).",
                            isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Verwijderen", role: .destructive) { Task { await delete() } }
        }
        .onAppear(perform: resetForm)
    }

    private func resetForm() {
        let n = notice
        updStatus = n.isClosed ? n.status : n.nextStatus
        messageNl = ""
        messageEn = ""
        notify = n.notify
        editComps = false
        comps = Dictionary(n.components.map { ($0.id, $0.impact) }, uniquingKeysWith: { a, _ in a })
        error = nil
    }

    private func fillTemplate() {
        let (nl, en) = NoticeComponentPicker.names(notice.components.map(\.id), overview: overview)
        guard let t = Labels.noticeTemplate(updStatus, nl: nl, en: en) else { return }
        messageNl = t.0
        messageEn = t.1
    }

    private func postUpdate() async {
        let mNl = messageNl.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !mNl.isEmpty else { error = APIError.text("notice_message_missing"); return }
        var params: [String: Any?] = [
            "op": "notice_update", "id": noticeID, "status": updStatus, "message_nl": String(mNl.prefix(4000)),
            "message_en": String(messageEn.trimmingCharacters(in: .whitespacesAndNewlines).prefix(4000)), "notify": notify,
        ]
        if editComps && !notice.isMaintenance { params["components"] = NoticeComponentPicker.payload(comps) }
        sending = true
        error = nil
        defer { sending = false }
        do {
            let r = try await session.call("status", params)
            session.show(NoticeComponentPicker.toast("Update geplaatst", r))
            await reload()
            resetForm()
        } catch {
            if error is CancellationError { return }
            if let e = error as? APIError, e.code == "auth" { return }
            self.error = (error as? APIError)?.errorDescription ?? APIError.text("server_error")
        }
    }

    private func delete() async {
        do {
            try await session.call("status", ["op": "notice_delete", "id": noticeID])
            session.show("Melding verwijderd.")
            await reload()
            dismiss()
        } catch {
            session.report(error)
        }
    }
}
