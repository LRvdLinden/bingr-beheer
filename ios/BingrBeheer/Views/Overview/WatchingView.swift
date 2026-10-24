import SwiftUI

/// Kijkt nu (tik op de tegel op het overzicht): wie er nu kijkt, met account, profiel, apparaat, platform, titel en soort,
/// sinds wanneer en de laatste ping (actie streams_now). Persoonsgegevens alleen via de functie admin (e-mail gemaskeerd).
/// Ververst elke 30 seconden zolang het scherm open is; een tik op een account opent het account.
struct WatchingView: View {
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var data: LiveStreams?
    @State private var error: String?

    var body: some View {
        List {
            if let error {
                Text(error).foregroundStyle(Color.warn).listRowBackground(Color.surface1)
            }
            if let d = data {
                Section {
                    if d.items.isEmpty {
                        EmptyText(text: "Er kijkt nu niemand.").listRowBackground(Color.surface1)
                    }
                    ForEach(d.items) { s in
                        NavigationLink {
                            UserDetailView(userID: s.userID, fallbackEmail: s.email, fallbackName: s.name)
                        } label: {
                            row(s)
                        }
                        .listRowBackground(Color.surface1)
                    }
                } header: {
                    Text(summary(d))
                } footer: {
                    Text("Ping in de laatste 90 seconden · ververst elke 30 s")
                }
            } else if error == nil {
                HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .screenBackground()
        .navigationTitle("Kijkt nu")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button("Klaar") { dismiss() } }
        }
        .refreshableCommand { await load() }
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }

    private func summary(_ d: LiveStreams) -> String {
        var parts = [Fmt.plural(d.total, "stream", "streams"), Fmt.plural(d.accounts, "account", "accounts")]
        for (k, name) in [("live", "live"), ("movie", "film"), ("episode", "aflevering")] where (d.byKind[k] ?? 0) > 0 {
            parts.append("\(Fmt.num(d.byKind[k])) \(name)")
        }
        return parts.joined(separator: " · ")
    }

    private func row(_ s: LiveStream) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: Labels.platformIcon(s.platformKey))
                .font(.title3)
                .frame(width: 40, height: 40)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.surface2))
                .accessibilityLabel(Labels.platform(s.platformKey))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(s.what).font(.body.weight(.semibold)).lineLimit(2)
                    if let k = s.kindName { Chip(text: k, tone: s.kind == "live" ? .bad : .neutral) }
                }
                HStack(spacing: 6) {
                    Text(s.name ?? s.email).font(.subheadline.weight(.semibold)).lineLimit(1)
                    if s.name != nil { Text(s.email).font(.caption).foregroundStyle(Color.textSecondary).lineLimit(1) }
                    if s.plan == "lifetime" { Chip(text: "Lifetime", tone: .warn) }
                    if let c = s.country { Text(Country.flag(c)).accessibilityLabel(Country.name(c)) }
                }
                Text([s.profileName.map { "Profiel \($0)" }, s.deviceName ?? Labels.platform(s.platform), Labels.platform(s.platformKey),
                      s.appVersion.map { "Bingr \($0)" }].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(Color.textDim).lineLimit(2)
                Text([s.startedAt.map { "Sinds \(Fmt.time($0)) (\(duration($0)))" }, s.lastPing.map { "laatste ping \(ping($0))" }]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(Color.textDim)
            }
        }
        .padding(.vertical, 4)
    }

    private func duration(_ from: Date) -> String {
        let m = max(0, Int(Date().timeIntervalSince(from) / 60))
        return m < 1 ? "net begonnen" : m < 60 ? "\(m) min" : "\(m / 60) u \(m % 60) min"
    }

    private func ping(_ at: Date) -> String {
        let s = max(0, Int(Date().timeIntervalSince(at)))
        return s < 60 ? "\(s) s geleden" : "\(s / 60) min geleden"
    }

    private func load() async {
        do {
            data = LiveStreams(try await session.call("streams_now"))
            error = nil
        } catch {
            if error is CancellationError || (error as? APIError)?.code == "auth" { return }
            self.error = (error as? APIError)?.errorDescription ?? APIError.text("server_error")
        }
    }
}
