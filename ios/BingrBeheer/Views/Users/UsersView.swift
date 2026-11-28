import SwiftUI

/// Tab Gebruikers: filter (alle / geblokkeerd), zoeken op naam of begin van het e-mailadres, lijst (nieuwste eerst) en details per account.
struct UsersView: View {
    @Environment(Session.self) private var session
    @State private var query = ""
    @State private var items: [UserRow] = []
    @State private var total = 0
    @State private var page = 0
    @State private var loading = false
    @State private var loaded = false
    @State private var error: String?
    @State private var blockedTotal: Int?
    @State private var freeTotal: Int?
    @State private var lifetimeTotal: Int?
    @State private var sandboxTotal: Int?
    /// De server kent het filter Sandbox nog niet (antwoord zonder `sandbox_total`).
    @State private var sandboxUnknown = false
    @State private var countries: CountryStats?
    /// Aantallen per soort abonnement (`access_totals`); nil = de server geeft ze nog niet.
    @State private var accessTotals: [String: Int]?

    private let pageSize = 50

    var body: some View {
        List {
            filterBar
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            if let error {
                Text(error).foregroundStyle(Color.warn).listRowBackground(Color.surface1)
            }
            ForEach(items) { u in
                NavigationLink(value: u) {
                    UserRowView(user: u)
                }
                .listRowBackground(Color.surface1)
                .onAppear {
                    if u.id == items.last?.id { Task { await loadMore() } }
                }
            }
            if loaded && items.isEmpty && error == nil {
                EmptyText(text: sandboxUnknown ? "De server kent het filter Sandbox nog niet."
                          : session.usersFilter.hasPrefix("access:") ? (accessTotals == nil ? "De server kent dit filter nog niet." : "Geen accounts met dit abonnement.")
                          : Self.emptyText[session.usersFilter] ?? (session.usersFilter.hasPrefix("country:") ? "Geen accounts uit dit land." : "Geen accounts gevonden."))
                    .listRowBackground(Color.surface1)
            }
            if loading {
                HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .screenBackground()
        .navigationTitle("Gebruikers")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Text(Fmt.plural(total, "account", "accounts")).font(.caption).foregroundStyle(Color.textDim)
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Zoek op naam of begin van e-mailadres")
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .navigationDestination(for: UserRow.self) { u in
            UserDetailView(userID: u.id, fallbackEmail: u.email, fallbackName: u.fullName)
        }
        .refreshableCommand { await reload() }
        .task(id: "\(query)|\(session.usersFilter)|\(session.usersRevision)") {
            if loaded { try? await Task.sleep(for: .milliseconds(300)) }
            if Task.isCancelled { return }
            await reload()
        }
    }

    private static let filters: [Option] = [
        .init("", "Alle accounts"), .init("free", "Gratis"), .init("lifetime", "Lifetime"), .init("custom", "Eigen limieten"), .init("sandbox", "Sandbox"), .init("blocked", "Geblokkeerd"),
    ]
    private static let emptyText = [
        "blocked": "Geen geblokkeerde accounts.", "free": "Geen Gratis-accounts gevonden.", "lifetime": "Geen Lifetime-accounts gevonden.",
        "custom": "Geen accounts met eigen limieten.", "sandbox": "Geen accounts met toegang via de sandbox.",
    ]

    private func count(_ key: String) -> Int? {
        switch key {
        case "blocked": return blockedTotal
        case "free": return freeTotal
        case "lifetime": return lifetimeTotal
        case "sandbox": return sandboxTotal
        default: return nil
        }
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                accessMenu.padding(.leading, 16)
                countryMenu
                filterButtons
            }
        }
        .task {
            if countries == nil, let j = try? await session.call("countries") { countries = CountryStats(j) }
        }
    }

    private static let accessChoices: [(key: String, label: String)] = [
        ("free", "Gratis"), ("legacy_lifetime", "Oude Lifetime"), ("lifetime", "Lifetime (gekocht)"), ("gifted_lifetime", "Gratis Lifetime gegeven"),
        ("subscription", "Alle Premium-abonnementen"), ("monthly", "Maand"), ("half_year", "Halfjaar"), ("yearly", "Jaar"),
    ]

    private func accessCount(_ key: String) -> Int? {
        guard let t = accessTotals else { return nil }
        if key == "subscription" { return ["monthly", "half_year", "yearly", "subscription"].reduce(0) { $0 + (t[$1] ?? 0) } }
        return t[key] ?? 0
    }

    /// Filter op wat een account precies heeft (Gratis, Oude Lifetime, Lifetime, Gratis Lifetime gegeven, Maand, Halfjaar, Jaar); één filter tegelijk.
    private var accessMenu: some View {
        let cur = session.usersFilter.hasPrefix("access:") ? String(session.usersFilter.dropFirst(7)) : ""
        let name = Self.accessChoices.first { $0.key == cur }?.label
        return Menu {
            Button("Alle abonnementen") { session.usersFilter = "" }
            ForEach(Self.accessChoices, id: \.key) { c in
                Button(accessCount(c.key).map { "\(c.label) (\(Fmt.num($0)))" } ?? c.label) { session.usersFilter = "access:\(c.key)" }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "creditcard")
                Text(name ?? "Abonnement")
                Image(systemName: "chevron.down").font(.caption2.weight(.bold))
            }
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .foregroundStyle(cur.isEmpty ? Color.textSecondary : Color.white)
            .background(Capsule().fill(cur.isEmpty ? Color.surface2 : Color.bingrRed))
        }
        .accessibilityLabel("Filter op abonnement")
    }

    /// Filter op land (laatst gezien land); één filter tegelijk, net als op het web.
    private var countryMenu: some View {
        let cur = session.usersFilter.hasPrefix("country:") ? String(session.usersFilter.dropFirst(8)) : ""
        return Menu {
            Button("Alle landen") { session.usersFilter = "" }
            ForEach(countries?.items ?? []) { x in
                Button("\(Country.label(x.country)) (\(Fmt.num(x.accounts)))") { session.usersFilter = "country:\(x.country)" }
            }
            if let c = countries, c.unknown > 0 {
                Button("Onbekend (\(Fmt.num(c.unknown)))") { session.usersFilter = "country:?" }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "globe.europe.africa")
                Text(cur.isEmpty ? "Land" : cur == "?" ? "Onbekend" : Country.label(cur))
                Image(systemName: "chevron.down").font(.caption2.weight(.bold))
            }
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .foregroundStyle(cur.isEmpty ? Color.textSecondary : Color.white)
            .background(Capsule().fill(cur.isEmpty ? Color.surface2 : Color.bingrRed))
        }
        .accessibilityLabel("Filter op land")
    }

    private var filterButtons: some View {
        HStack(spacing: 8) {
            ForEach(Self.filters, id: \.key) { f in
                let key = f.key, label = f.label
                let on = session.usersFilter == key
                Button {
                    session.usersFilter = key
                } label: {
                    HStack(spacing: 6) {
                        Text(label)
                        if let n = count(key) {
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
            Spacer()
        }
        .padding(.horizontal, 16)
    }

    private func reload() async {
        page = 0
        await fetch(page: 0, replace: true)
    }

    private func loadMore() async {
        guard !loading, items.count < total else { return }
        await fetch(page: page + 1, replace: false)
    }

    private func fetch(page p: Int, replace: Bool) async {
        loading = true
        defer { loading = false }
        do {
            let filter: String? = session.usersFilter.isEmpty ? nil : session.usersFilter
            let r = try await session.call("users", ["q": query.trimmingCharacters(in: .whitespaces), "page": p, "page_size": pageSize, "filter": filter])
            let rows = r["items"].array.map(UserRow.init)
            total = r["total"].int ?? 0
            if let b = r["blocked_total"].int { blockedTotal = b }
            if let n = r["free_total"].int { freeTotal = n }
            if let n = r["lifetime_total"].int { lifetimeTotal = n }
            if let n = r["sandbox_total"].int { sandboxTotal = n }
            if let o = r["access_totals"].object { accessTotals = o.compactMapValues { $0.int } }
            sandboxUnknown = session.usersFilter == "sandbox" && r["sandbox_total"].int == nil
            page = p
            if replace { items = rows } else { items += rows.filter { n in !items.contains { $0.id == n.id } } }
            error = nil
            loaded = true
        } catch {
            if error is CancellationError { return }
            self.error = (error as? APIError)?.errorDescription
            session.report(error)
        }
    }
}

struct UserRowView: View {
    let user: UserRow

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // met naam: naam vet, het gemaskeerde e-mailadres eronder; zonder naam alleen het adres (zoals op het web)
            if let name = user.fullName {
                VStack(alignment: .leading, spacing: 1) {
                    Text(name).font(.body.weight(.semibold)).lineLimit(1)
                    Text(user.email).font(.caption).foregroundStyle(Color.textSecondary).lineLimit(1)
                }
            }
            HStack(spacing: 6) {
                if user.fullName == nil {
                    Text(user.email).font(.body.weight(.semibold)).lineLimit(1)
                }
                if !user.confirmed { Chip(text: "onbevestigd", tone: .warn) }
                if user.newsletter == false { Chip(text: "Geen nieuwsbrief", icon: "envelope.badge") }
                if user.isBlocked { Chip(text: "Geblokkeerd", tone: .bad, icon: "nosign") }
                AccessChip(access: user.access, plan: user.plan)
                if user.sandbox { Chip(text: "Sandbox", tone: .warn, icon: "testtube.2") }
                if let c = user.country { Text(Country.flag(c)).font(.caption).accessibilityLabel(Country.name(c)) }
            }
            HStack(spacing: 10) {
                Label(Fmt.date(user.createdAt), systemImage: "calendar")
                Label(Fmt.ago(user.lastSignInAt), systemImage: "arrow.right.circle")
            }
            .font(.caption)
            .foregroundStyle(Color.textDim)
            .labelStyle(CompactLabelStyle())
            HStack(spacing: 6) {
                Label("\(Fmt.num(user.deviceCount))", systemImage: "rectangle.on.rectangle")
                ForEach(user.platforms, id: \.self) { p in
                    Image(systemName: Labels.platformIcon(p)).accessibilityLabel(Labels.platform(p))
                }
                Text("·")
                Label("\(Fmt.num(user.profileCount))", systemImage: "person.crop.circle")
                if !user.appVersions.isEmpty {
                    Text("·")
                    Text(user.appVersions.joined(separator: ", ")).lineLimit(1)
                }
            }
            .font(.caption)
            .foregroundStyle(Color.textSecondary)
            .labelStyle(CompactLabelStyle())
        }
        .padding(.vertical, 4)
    }
}

/// Icoon + tekst dicht op elkaar.
struct CompactLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 3) {
            configuration.icon
            configuration.title
        }
    }
}

/// Wat het account precies heeft als klein label: Lifetime goud, abonnement groen, gegeven Lifetime blauw, Gratis grijs.
/// Een oudere server geeft het niet: dan het oude Gratis/Lifetime-label.
struct AccessChip: View {
    let access: AccountAccess
    let plan: AccountPlan

    var body: some View {
        if let code = access.code {
            let color: Color = access.isSubscription ? Color(hex: 0x8BE3A5) : code == "gifted_lifetime" ? Color(hex: 0x9CC3FF)
                : access.isLifetime ? Color(hex: 0xFFD54A) : Color.textSecondary
            HStack(spacing: 4) {
                Text(access.text)
                if let p = access.providerName, access.isSubscription || code == "lifetime" { Text(p).foregroundStyle(Color.textDim) }
            }
            .font(.caption2.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .foregroundStyle(color)
            .background(Capsule().fill(color.opacity(0.14)))
        } else {
            PlanChip(plan: plan)
        }
    }
}

/// Abonnement als klein label: Lifetime goud, Gratis grijs.
struct PlanChip: View {
    let plan: AccountPlan

    var body: some View {
        if plan.isLifetime {
            Text(plan.chipText)
                .font(.caption2.weight(.semibold))
                .lineLimit(1)
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .foregroundStyle(Color(hex: 0xFFD54A))
                .background(Capsule().fill(Color(hex: 0xF5C518).opacity(0.14)))
        } else {
            Chip(text: plan.chipText)
        }
    }
}
