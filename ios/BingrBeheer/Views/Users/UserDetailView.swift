import SwiftUI

/// Details van een account (actie `user_detail`) met apparaten en de knop voor een wachtwoord-reset (`send_reset`).
struct UserDetailView: View {
    let userID: String
    let fallbackEmail: String
    @Environment(Session.self) private var session
    @State private var user: UserDetail?
    @State private var error: String?
    @State private var confirmReset = false
    @State private var sending = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let error {
                    NoticeBanner(text: error)
                } else if user == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
                if let u = user {
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
                    }
                    .card()
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
        .alert("Wachtwoord-reset", isPresented: $confirmReset) {
            Button("Annuleren", role: .cancel) {}
            Button("Versturen") { Task { await sendReset() } }
        } message: {
            Text("Een wachtwoord-reset-mail sturen naar \(user?.email ?? fallbackEmail)?")
        }
    }

    private func load() async {
        do {
            user = UserDetail(try await session.call("user_detail", ["id": userID]))
            error = nil
        } catch {
            if error is CancellationError { return }
            self.error = (error as? APIError)?.errorDescription ?? APIError.text("server_error")
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
