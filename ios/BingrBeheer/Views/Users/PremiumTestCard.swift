import SwiftUI

/// Build 181: "Premium testen" in de details van een account (zoals uPremTest in web/admin.js). Een testaccount ziet Premium
/// al, ook met alles uit (acties premium_settings om te lezen, premium_test om aan of uit te zetten).
struct PremiumTestCard: View {
    let userID: String
    @Environment(Session.self) private var session
    @State private var on: Bool?
    @State private var busy = false

    var body: some View {
        Group {
            if let on {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Premium testen").font(.headline)
                    Text(on ? "Dit account ziet Premium al (als nieuw, met proef)." : "Dit account ziet Premium alsof alles aan staat. Test met een gratis account.")
                        .font(.caption).foregroundStyle(Color.textDim)
                    Button {
                        Task { await toggle(!on) }
                    } label: {
                        HStack {
                            if busy { ProgressView() }
                            Text(on ? "Premium-test uit" : "Premium testen met dit account")
                        }
                    }
                    .disabled(busy)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .card()
            }
        }
        .task(id: userID) { await load() }
    }

    private func load() async {
        guard let j = try? await session.call("premium_settings") else { on = nil; return }
        let ids: [String] = PremiumSettings(j["settings"]).testUsers.map { $0.lowercased() }
        on = ids.contains(userID.lowercased())
    }

    private func toggle(_ value: Bool) async {
        busy = true
        defer { busy = false }
        do {
            try await session.call("premium_test", ["user_id": userID, "on": value])
            session.show(value ? "Premium-test staat aan voor dit account." : "Premium-test staat uit voor dit account.")
            on = value
        } catch {
            if (error as? APIError)?.code != "auth" { session.show(error.localizedDescription, bad: true) }
        }
    }
}
