import SwiftUI

/// Tab Betalingen: alleen-lezen controle op misgelopen betalingen (actie `payments_check`, zelfde gegevens als de tab Betalingen
/// van het web-dashboard). Wat Apple verkocht en Stripe als betaald meldt (7 dagen) tegenover wat Bingr heeft vastgelegd.
/// Er wordt niets aangepast; nooit namen, e-mailadressen of volledige betaal-id's.
struct PaymentsView: View {
    @Environment(Session.self) private var session
    @State private var data: PaymentsCheck?
    @State private var error: String?
    @State private var busy = false

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 12)]

    var body: some View {
        List {
            if let error { NoticeBanner(text: error).listRowBackground(Color.clear) }
            if let d = data {
                Section {
                    verdict(d)
                    ForEach(d.issues) { i in
                        Label(i.nl, systemImage: i.isError ? "exclamationmark.octagon.fill" : "exclamationmark.triangle.fill")
                            .font(.callout)
                            .foregroundStyle(i.isError ? Color.tone(.bad) : Color.tone(.warn))
                    }
                } footer: {
                    Text("Gecontroleerd op \(Fmt.dateTime(d.checkedAt)). De cijfers van Apple lopen een dag tot twee dagen achter.")
                }
                Section {
                    LazyVGrid(columns: columns, spacing: 12) {
                        KPITile(label: "In Stripe betaald", value: d.queried ? Fmt.num(d.paidInStripe ?? 0) : "—",
                                hint: d.queried ? "laatste 7 dagen" : "Stripe niet bevraagd", small: true)
                        KPITile(label: "Bij ons vastgelegd", value: Fmt.num(d.recorded7d), hint: "Lifetime en abonnementen, 7 dagen", small: true)
                        KPITile(label: "Ontbreekt bij ons", value: Fmt.num(d.missing.count), hint: "betaald in Stripe",
                                valueColor: d.missing.isEmpty ? .white : Color.tone(.bad), small: true)
                        KPITile(label: "Apple niet gekoppeld", value: Fmt.num(d.unlinked7d),
                                hint: "\(Fmt.num(d.unlinkedNoMail)) zonder claim-mail", small: true)
                        KPITile(label: "Stripe hangend", value: Fmt.num(d.pendingOverHour + d.incompleteOverDay),
                                hint: "pending > 1 u of onvolledig > 1 dag", small: true)
                        KPITile(label: "Achterstallig", value: Fmt.num(d.pastDue), hint: "Stripe-abonnementen", small: true)
                        if d.hasSandbox {
                            // build 193: tik = de accountlijst met het filter Sandbox
                            Button {
                                session.usersFilter = "sandbox"
                                session.section = .users
                            } label: {
                                KPITile(label: "Lifetime via sandbox", value: Fmt.num(d.sandboxLifetime),
                                        hint: "\(Fmt.num(d.sandboxActive7d)) actief in 7 dagen · \(Fmt.num(d.sandboxTemporary)) tijdelijk",
                                        valueColor: d.sandboxLifetime == 0 ? .white : Color.tone(.warn), small: true)
                            }
                            .buttonStyle(.plain)
                            .accessibilityHint("Toont deze accounts")
                        }
                    }
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                }
                Section {
                    if d.funnelDays.isEmpty {
                        Text(d.hasFunnel ? "Nog geen meldingen. De apps en de website tellen vanaf build 193." : "De server telt de betaalstappen nog niet.")
                            .foregroundStyle(Color.textDim)
                    }
                    ForEach(d.funnelDays.reversed()) { f in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text("\(f.date) · \(f.groupText)").font(.subheadline.weight(.semibold)).monospacedDigit()
                                Spacer()
                                Text(f.rate).font(.subheadline.monospacedDigit()).foregroundStyle(Color.textSecondary)
                            }
                            Text("betaalscherm \(f.shown) · gestart \(f.started) · gelukt \(f.ok) · mislukt \(f.failed) · afgebroken \(f.cancelled)")
                                .font(.caption).foregroundStyle(Color.textSecondary).monospacedDigit()
                        }
                    }
                    if !d.topErrors.isEmpty {
                        Text("Foutcodes: " + d.topErrors.map { "\($0.error) \(Fmt.num($0.count))" }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Color.textSecondary)
                    }
                } header: {
                    Text("Betaaltrechter per dag")
                } footer: {
                    Text("Anonieme tellingen van de apps en de website: betaalscherm getoond, aankoop gestart, gelukt, mislukt of afgebroken. Het percentage is gelukt van gestart.")
                }
                Section("In Stripe betaald, bij ons niet vastgelegd") {
                    if d.missing.isEmpty {
                        Text(d.queried ? "Geen. Alles wat Stripe als betaald meldt, staat bij ons." : "Stripe is niet bevraagd, dus er is niets om te vergelijken.")
                            .foregroundStyle(Color.textDim)
                    }
                    ForEach(d.missing) { m in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(m.kindText) …\(m.shortID)").font(.subheadline.weight(.semibold))
                                Text(Fmt.dateTime(m.paidAt)).font(.caption).foregroundStyle(Color.textSecondary)
                            }
                            Spacer()
                            Text(Fmt.euro(m.amountCents)).monospacedDigit()
                        }
                    }
                }
                Section {
                    ForEach(d.days.reversed()) { day in
                        HStack {
                            Text(day.date).font(.subheadline.monospacedDigit())
                            Spacer()
                            Text("verkocht \(day.appleSold) · abo \(day.appleNew) · lifetime \(day.appleLifetime)")
                                .font(.caption).foregroundStyle(Color.textSecondary).monospacedDigit()
                        }
                    }
                } header: {
                    Text("Apple per dag")
                } footer: {
                    Text("Verkocht = Apple-verkopen uit App Store Connect (t/m \(d.lastSalesDate ?? "—")); abo en lifetime = wat Bingr als nieuw heeft vastgelegd.")
                }
                Section("Apple-meldingen (3 dagen)") {
                    if d.notifications.isEmpty { Text("Geen meldingen.").foregroundStyle(Color.textDim) }
                    ForEach(d.notifications, id: \.0) { n in
                        HStack { Text(n.0).font(.caption); Spacer(); Text(Fmt.num(n.1)).monospacedDigit() }
                    }
                }
            } else if error == nil {
                Section { HStack { ProgressView(); Text("Controleren…").foregroundStyle(Color.textDim) } }
            }
        }
        .scrollContentBackground(.hidden)
        .screenBackground()
        .navigationTitle("Betalingen")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { Task { await load() } } label: { Label("Nu controleren", systemImage: "arrow.clockwise") }.disabled(busy)
            }
        }
        .refreshableCommand { await load() }
        .task { if data == nil { await load() } }
    }

    private func verdict(_ d: PaymentsCheck) -> some View {
        let tone: Tone = d.ok ? .good : (d.hasErrors ? .bad : .warn)
        return VStack(alignment: .leading, spacing: 4) {
            Label(d.ok ? "Geen misgelopen betalingen gevonden" : (d.hasErrors ? "Er ontbreken betalingen" : "Let op"),
                  systemImage: d.ok ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                .font(.headline).foregroundStyle(Color.tone(tone))
            if d.ok { Text("Alles wat Apple en Stripe melden is bij ons vastgelegd.").font(.caption).foregroundStyle(Color.textSecondary) }
        }
    }

    private func load() async {
        if busy { return }
        busy = true
        defer { busy = false }
        do {
            data = PaymentsCheck(try await session.call("payments_check", [:]))
            error = nil
        } catch {
            if !(error is CancellationError) { self.error = (error as? APIError)?.errorDescription ?? APIError.text("server_error") }
        }
    }
}
