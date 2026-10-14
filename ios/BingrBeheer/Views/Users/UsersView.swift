import SwiftUI

/// Tab Gebruikers: zoeken op begin van het e-mailadres, lijst (nieuwste eerst) en details per account.
struct UsersView: View {
    @Environment(Session.self) private var session
    @State private var query = ""
    @State private var items: [UserRow] = []
    @State private var total = 0
    @State private var page = 0
    @State private var loading = false
    @State private var loaded = false
    @State private var error: String?

    private let pageSize = 50

    var body: some View {
        List {
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
                EmptyText(text: "Geen accounts gevonden.").listRowBackground(Color.surface1)
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
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Zoek op begin van e-mailadres")
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .navigationDestination(for: UserRow.self) { u in
            UserDetailView(userID: u.id, fallbackEmail: u.email)
        }
        .refreshable { await reload() }
        .task(id: query) {
            if loaded { try? await Task.sleep(for: .milliseconds(300)) }
            if Task.isCancelled { return }
            await reload()
        }
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
            let r = try await session.call("users", ["q": query.trimmingCharacters(in: .whitespaces), "page": p, "page_size": pageSize])
            let rows = r["items"].array.map(UserRow.init)
            total = r["total"].int ?? 0
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
            HStack(spacing: 6) {
                Text(user.email).font(.body.weight(.semibold)).lineLimit(1)
                if !user.confirmed { Chip(text: "onbevestigd", tone: .warn) }
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
