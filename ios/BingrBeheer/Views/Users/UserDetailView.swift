import SwiftUI

/// Details van een account (actie `user_detail`) met apparaten, wachtwoord-reset (`send_reset`), blokkeren en opheffen
/// (`user_block` / `user_unblock`, met geschiedenis) en verwijderen (`user_delete`, met het e-mailadres als bevestiging).
struct UserDetailView: View {
    let userID: String
    let fallbackEmail: String
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var user: UserDetail?
    @State private var error: String?
    @State private var confirmReset = false
    @State private var sending = false
    @State private var showBlock = false
    @State private var unblockNotify = true
    @State private var unblocking = false
    @State private var confirmUnblock = false
    // verwijderen
    @State private var deleteNotify = true
    @State private var deleteTickets = false
    @State private var deleteNote = ""
    @State private var deleteConfirm = ""
    @State private var deleting = false
    @State private var confirmDelete = false
    @State private var deleteError: String?
    // abonnement
    @State private var planChoice = "free"
    @State private var planStreams = ""
    @State private var planDevices = ""
    @State private var planNote = ""
    @State private var planSaving = false
    @State private var planError: String?
    @State private var confirmDowngrade = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let error {
                    NoticeBanner(text: error)
                } else if user == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
                if let u = user {
                    if let b = u.block { blockBanner(b) }
                    VStack(alignment: .leading, spacing: 10) {
                        InfoRow("Aangemaakt", Fmt.dateTime(u.createdAt))
                        InfoRow("Laatst ingelogd", u.lastSignInAt.map { Fmt.dateTime($0) } ?? "nooit")
                        InfoRow("Bevestigd", u.confirmed ? "Ja" : "Nee")
                        InfoRow("Taal", u.lang ?? "—")
                        InfoRow("Profielen", Fmt.num(u.profileCount))
                        InfoRow("Actief (30 d)", "\(Fmt.num(u.activeDays30d)) dagen")
                        InfoRow("Kijkt nu", Fmt.num(u.watchingNow))
                        InfoRow("Berichten per e-mail", u.emailOptOut ? "Afgemeld" : "Aan")
                    }
                    .card()

                    planCard(u)

                    VStack(alignment: .leading, spacing: 12) {
                        Text("Apparaten (\(u.devices.count))").font(.headline)
                        if u.devices.isEmpty {
                            EmptyText(text: "Geen apparaten.")
                        }
                        ForEach(u.devices) { d in
                            DeviceRow(device: d)
                            if d.id != u.devices.last?.id { Divider().overlay(Color.line) }
                        }
                    }
                    .card()

                    VStack(alignment: .leading, spacing: 10) {
                        Button {
                            confirmReset = true
                        } label: {
                            HStack {
                                if sending { ProgressView().tint(.white) }
                                Text("Stuur wachtwoord-reset")
                            }
                        }
                        .buttonStyle(.bingrGhost)
                        .disabled(sending)
                        Text("De gebruiker krijgt de standaard reset-mail van Bingr en kiest zelf een nieuw wachtwoord. Je ziet of wijzigt nooit een wachtwoord.")
                            .font(.caption).foregroundStyle(Color.textDim)
                        if u.block == nil {
                            Button {
                                showBlock = true
                            } label: {
                                Label("Blokkeren…", systemImage: "nosign")
                            }
                            .buttonStyle(.bingrGhost)
                            .padding(.top, 6)
                            Text("De klant kan dan niet meer inloggen en wordt op alle apparaten uitgelogd.")
                                .font(.caption).foregroundStyle(Color.textDim)
                        }
                    }
                    .card()

                    if !u.blocks.isEmpty { blockHistory(u.blocks) }
                    deleteZone(u)
                }
            }
            .padding(16)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .screenBackground()
        .navigationTitle(user?.email ?? fallbackEmail)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { if user == nil { await load() } }
        .sheet(isPresented: $showBlock) {
            BlockSheet(userID: userID, email: user?.email ?? fallbackEmail) {
                session.usersRevision += 1
                Task { await load() }
            }
        }
        .alert("Blokkade opheffen", isPresented: $confirmUnblock) {
            Button("Annuleren", role: .cancel) {}
            Button("Opheffen") { Task { await unblock() } }
        } message: {
            Text("\(user?.email ?? fallbackEmail) kan daarna weer inloggen.\(unblockNotify ? " De klant krijgt een mail." : "")")
        }
        .confirmationDialog("Account definitief verwijderen?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Verwijderen", role: .destructive) { Task { await deleteAccount() } }
            Button("Annuleren", role: .cancel) {}
        } message: {
            Text("\(user?.email ?? fallbackEmail) en alle gegevens worden verwijderd. Dit kan niet ongedaan worden gemaakt.")
        }
        .alert("Terug naar Gratis?", isPresented: $confirmDowngrade) {
            Button("Annuleren", role: .cancel) {}
            Button("Gratis maken", role: .destructive) { Task { await savePlan() } }
        } message: {
            Text("Statistieken, nu aan het kijken, Trakt en thema's gaan dan op slot voor \(user?.email ?? fallbackEmail).")
        }
        .alert("Wachtwoord-reset", isPresented: $confirmReset) {
            Button("Annuleren", role: .cancel) {}
            Button("Versturen") { Task { await sendReset() } }
        } message: {
            Text("Een wachtwoord-reset-mail sturen naar \(user?.email ?? fallbackEmail)?")
        }
    }

    private func load() async {
        do {
            let u = UserDetail(try await session.call("user_detail", ["id": userID]))
            user = u
            planChoice = u.plan.plan
            planStreams = u.plan.maxStreams.map(String.init) ?? ""
            planDevices = u.plan.maxDevices.map(String.init) ?? ""
            planNote = u.plan.note ?? ""
            planError = nil
            error = nil
        } catch {
            if error is CancellationError { return }
            self.error = (error as? APIError)?.errorDescription ?? APIError.text("server_error")
        }
    }

    // MARK: abonnement

    private func planCard(_ u: UserDetail) -> some View {
        let d = AccountPlan.defaults[planChoice] ?? AccountPlan.defaults["free"]!
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text("Abonnement").font(.headline)
                PlanChip(plan: u.plan)
            }
            Text(u.plan.isLifetime
                 ? ["Lifetime", u.plan.sourceText, u.plan.updatedAt.map { Fmt.date($0) }].compactMap { $0 }.joined(separator: " · ")
                 : "Gratis: 2 tegelijk kijken, 8 apparaten, 1 server, zonder statistieken, nu aan het kijken, Trakt en thema's.")
                .font(.caption).foregroundStyle(Color.textDim)
            Picker("Abonnement", selection: $planChoice) {
                ForEach(AccountPlan.options, id: \.key) { Text($0.label).tag($0.key) }
            }
            .pickerStyle(.segmented)
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Tegelijk kijken").font(.subheadline)
                    TextField("standaard \(d.streams)", text: $planStreams)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.numberPad)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Apparaten").font(.subheadline)
                    TextField("standaard \(d.devices)", text: $planDevices)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.numberPad)
                }
            }
            Text("Leeg = standaard van het abonnement (Gratis 2 / 8, Lifetime 6 / 15).").font(.caption).foregroundStyle(Color.textDim)
            TextField("Notitie (intern, de klant ziet hem niet)", text: $planNote, axis: .vertical)
                .textFieldStyle(.roundedBorder)
            if let planError {
                Text(planError).font(.subheadline).foregroundStyle(Color.warn)
            }
            Button {
                if u.plan.isLifetime && planChoice == "free" { confirmDowngrade = true } else { Task { await savePlan() } }
            } label: {
                HStack {
                    if planSaving { ProgressView().tint(.white) }
                    Text("Abonnement opslaan")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bingr)
            .disabled(planSaving)
        }
        .card(highlight: u.plan.isLifetime ? Color(hex: 0xF5C518) : nil)
    }

    /// Leeg = nil (standaard); anders een heel getal binnen [1, max], of een fout.
    private func limit(_ text: String, max: Int) -> Int?? {
        let t = text.trimmingCharacters(in: .whitespaces)
        if t.isEmpty { return .some(nil) }
        guard let n = Int(t), (1...max).contains(n) else { return nil }
        return .some(n)
    }

    private func savePlan() async {
        guard let ms = limit(planStreams, max: 50) else { planError = APIError.text("bad_max_streams"); return }
        guard let md = limit(planDevices, max: 200) else { planError = APIError.text("bad_max_devices"); return }
        planSaving = true
        planError = nil
        defer { planSaving = false }
        do {
            // nil gaat niet mee in de aanvraag; de functie leest een ontbrekende limiet als standaard
            try await session.call("plan_set", [
                "id": userID, "plan": planChoice, "max_streams": ms, "max_devices": md,
                "note": planNote.trimmingCharacters(in: .whitespacesAndNewlines),
            ])
            session.show("Abonnement opgeslagen: \(planChoice == "lifetime" ? "Lifetime" : "Gratis")\(ms != nil || md != nil ? " met eigen limieten" : "").")
            session.usersRevision += 1
            await load()
        } catch {
            if error is CancellationError { return }
            if let e = error as? APIError, e.code == "auth" { return }
            planError = (error as? APIError)?.errorDescription ?? APIError.text("server_error")
        }
    }

    // MARK: blokkade

    private func blockBanner(_ b: AccountBlock) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Geblokkeerd \(b.untilText)", systemImage: "nosign")
                .font(.headline)
                .foregroundStyle(Color.white)
            Text(b.reason)
                .font(.subheadline)
                .foregroundStyle(Color.white.opacity(0.9))
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.black.opacity(0.35)))
                .overlay(alignment: .leading) { Rectangle().fill(Color.bingrRed).frame(width: 3) }
                .textSelection(.enabled)
            Text("Sinds \(Fmt.dateTime(b.createdAt)) · \(b.notified ? "klant gemaild" : "klant niet gemaild")")
                .font(.caption).foregroundStyle(Color.textDim)
            Toggle("Klant mailen dat het account weer actief is", isOn: $unblockNotify)
                .font(.subheadline)
                .tint(.bingrRed)
            Button {
                confirmUnblock = true
            } label: {
                HStack {
                    if unblocking { ProgressView().tint(.white) }
                    Text("Blokkade opheffen")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bingr)
            .disabled(unblocking)
        }
        .card(highlight: .bingrRed)
    }

    private func blockHistory(_ items: [AccountBlock]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Blokkades (\(items.count))").font(.headline)
            ForEach(items) { b in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(Fmt.dateTime(b.createdAt)).font(.subheadline.weight(.semibold))
                        if let ended = b.endedText {
                            Chip(text: ended)
                        } else {
                            Chip(text: "actief", tone: .bad)
                        }
                        if b.notified { Chip(text: "gemaild", icon: "envelope") }
                    }
                    Text(b.untilText).font(.caption).foregroundStyle(Color.textSecondary)
                    Text(b.reason).font(.caption).foregroundStyle(Color.textDim).textSelection(.enabled)
                }
                if b.id != items.last?.id { Divider().overlay(Color.line) }
            }
        }
        .card()
    }

    private func unblock() async {
        unblocking = true
        defer { unblocking = false }
        do {
            let r = try await session.call("user_unblock", ["id": userID, "notify": unblockNotify])
            session.show(r["email_sent"].bool == true ? "Blokkade opgeheven, klant gemaild." : "Blokkade opgeheven.")
            session.usersRevision += 1
            await load()
        } catch {
            session.report(error)
        }
    }

    // MARK: verwijderen

    /// Knop pas actief als het ingetypte adres lijkt te kloppen; de functie controleert het echte adres.
    private func confirmLooksOK(_ masked: String) -> Bool {
        let v = deleteConfirm.trimmingCharacters(in: .whitespaces).lowercased(), m = masked.lowercased()
        if v == m { return true }
        guard v.contains("@"), !v.contains("*"), !v.contains(" "), v.first == m.first,
              let vd = v.range(of: ".", options: .backwards), let md = m.range(of: ".", options: .backwards) else { return false }
        return v[vd.lowerBound...] == m[md.lowerBound...]
    }

    private func deleteZone(_ u: UserDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Account verwijderen").font(.headline).foregroundStyle(Color(hex: 0xFF8A8F))
            Text("Verwijdert het account met profielen, apparaten en sessies, instellingen, servers, kijkgeschiedenis, statistieken en verzamelingen. Dit kan niet ongedaan worden gemaakt. De klant kan daarna altijd een nieuw account maken.")
                .font(.caption).foregroundStyle(Color.textDim)
            Toggle("Bevestiging mailen vanaf support@bingr.online", isOn: $deleteNotify).font(.subheadline).tint(.bingrRed)
            Toggle(isOn: $deleteTickets) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Ook supporttickets verwijderen").font(.subheadline)
                    Text("Standaard bewaard, los van het account").font(.caption).foregroundStyle(Color.textDim)
                }
            }
            .tint(.bingrRed)
            TextField("Interne notitie (optioneel, alleen in het logboek)", text: $deleteNote, axis: .vertical)
                .textFieldStyle(.roundedBorder)
            VStack(alignment: .leading, spacing: 4) {
                Text("Typ het e-mailadres ter bevestiging").font(.subheadline)
                Text("Volledig, of precies zoals hierboven: \(u.email)").font(.caption).foregroundStyle(Color.textDim)
                TextField("E-mailadres", text: $deleteConfirm)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            if let deleteError {
                Text(deleteError).font(.subheadline).foregroundStyle(Color.warn)
            }
            Button(role: .destructive) {
                confirmDelete = true
            } label: {
                HStack {
                    if deleting { ProgressView().tint(.white) }
                    Text("Account definitief verwijderen")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bingrDanger)
            .disabled(deleting || !confirmLooksOK(u.email))
        }
        .card(highlight: .bad)
    }

    private func deleteAccount() async {
        deleting = true
        deleteError = nil
        defer { deleting = false }
        do {
            let r = try await session.call("user_delete", [
                "id": userID, "confirm": deleteConfirm.trimmingCharacters(in: .whitespaces), "notify": deleteNotify,
                "delete_tickets": deleteTickets, "reason": deleteNote.trimmingCharacters(in: .whitespacesAndNewlines),
            ])
            session.show(r["email_sent"].bool == true ? "Account verwijderd, bevestiging gemaild." : "Account verwijderd.")
            session.usersRevision += 1
            dismiss()
        } catch {
            if error is CancellationError { return }
            if let e = error as? APIError, e.code == "auth" { return }
            deleteError = (error as? APIError)?.errorDescription ?? APIError.text("server_error")
        }
    }

    private func sendReset() async {
        sending = true
        defer { sending = false }
        do {
            try await session.call("send_reset", ["user_id": userID])
            session.show("Reset-mail verstuurd.")
        } catch {
            session.report(error)
        }
    }
}

struct DeviceRow: View {
    let device: UserDetail.Device

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: Labels.platformIcon(device.platform))
                .font(.title3)
                .frame(width: 40, height: 40)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.surface3))
            VStack(alignment: .leading, spacing: 2) {
                Text(device.name ?? Labels.platform(device.platform)).font(.subheadline.weight(.semibold))
                Text([Labels.platform(device.platform), device.appVersion.map { "Bingr \($0)" }, device.osVersion]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(Color.textSecondary)
                Text("Laatst gezien \(Fmt.ago(device.lastSeenAt)) · gekoppeld \(Fmt.date(device.createdAt))")
                    .font(.caption).foregroundStyle(Color.textDim)
            }
        }
    }
}

/// Formulier om een account te blokkeren: reden (ziet de klant), duur en mail aan de klant.
struct BlockSheet: View {
    let userID: String
    let email: String
    var onDone: () -> Void
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var reason = ""
    @State private var preset = "7"
    @State private var until = Date().addingTimeInterval(7 * 86400)
    @State private var notify = true
    @State private var saving = false
    @State private var error: String?

    private static let presets: [Option] = [.init("1", "1 dag"), .init("7", "7 dagen"), .init("30", "30 dagen"), .init("0", "Onbepaald"), .init("custom", "Eigen datum")]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Bijvoorbeeld: je account is gedeeld met meer mensen dan toegestaan.", text: $reason, axis: .vertical)
                        .lineLimit(3...8)
                } header: {
                    Text("Reden")
                } footer: {
                    Text("De klant ziet deze tekst in de mail.")
                }
                Section {
                    Picker("Duur", selection: $preset) {
                        ForEach(Self.presets, id: \.key) { Text($0.label).tag($0.key) }
                    }
                    if preset != "0" {
                        DatePicker("Geblokkeerd tot", selection: $until, in: Date().addingTimeInterval(120)...)
                            .environment(\.locale, Fmt.nl)
                            .disabled(preset != "custom")
                    }
                } header: {
                    Text("Duur")
                } footer: {
                    Text(preset == "0" ? "De blokkade blijft staan tot je hem opheft." : "Eindigt vanzelf op \(Fmt.dateTime(until)); daarna kan de klant weer inloggen.")
                }
                Section {
                    Toggle("Klant mailen", isOn: $notify).tint(.bingrRed)
                } footer: {
                    Text("Mail vanaf support@bingr.online met de reden, de einddatum en een link om contact op te nemen (zonder inloggen).")
                }
                if let error {
                    Section { Text(error).foregroundStyle(Color.warn) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.black.ignoresSafeArea())
            .navigationTitle("Account blokkeren")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuleren") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving { ProgressView() } else { Button("Blokkeren") { Task { await save() } }.disabled(reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
                }
            }
            .onChange(of: preset) { _, p in
                if let days = Double(p), days > 0 { until = Date().addingTimeInterval(days * 86400) }
            }
        }
        .presentationDetents([.large])
    }

    private func save() async {
        let text = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { error = APIError.text("reason_missing"); return }
        saving = true
        error = nil
        defer { saving = false }
        let iso = ISO8601DateFormatter()
        do {
            let r = try await session.call("user_block", [
                "id": userID, "reason": text, "until": preset == "0" ? "onbepaald" : iso.string(from: until), "notify": notify,
            ])
            session.show(r["email_sent"].bool == true ? "Account geblokkeerd, klant gemaild." : notify ? "Account geblokkeerd (mail niet verstuurd)." : "Account geblokkeerd.",
                         bad: notify && r["email_sent"].bool != true)
            onDone()
            dismiss()
        } catch {
            if error is CancellationError { return }
            if let e = error as? APIError, e.code == "auth" { dismiss(); return }
            self.error = (error as? APIError)?.errorDescription ?? APIError.text("server_error")
        }
    }
}
