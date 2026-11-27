import SwiftUI

/// Tab Verzonden: welke mails de server heeft verstuurd (tijd, bron, ontvanger, onderwerp en of de mailserver de mail aannam).
/// Filter op resultaat en bron, zoeken op ontvanger of onderwerp, totalen van 7 dagen. Zelfde gegevens als de tab Verzonden
/// van het web-dashboard (actie `mail_log`). Aangenomen is niet hetzelfde als afgeleverd.
struct MailLogView: View {
    @Environment(Session.self) private var session
    @AppStorage("mailLogFilter") private var filter = "all"
    @State private var source = ""
    @State private var search = ""
    @State private var data: MailLog?
    @State private var error: String?

    private static let filters = [("all", "Alle"), ("ok", "Aangenomen"), ("failed", "Mislukt")]

    var body: some View {
        List {
            if let error { NoticeBanner(text: error).listRowBackground(Color.clear) }
            Section {
                Picker("Resultaat", selection: $filter) {
                    ForEach(Self.filters, id: \.0) { f in Text(f.1).tag(f.0) }
                }
                .pickerStyle(.segmented)
                Picker("Bron", selection: $source) {
                    Text("Alle bronnen").tag("")
                    ForEach(data?.sources ?? [], id: \.self) { s in Text(MailLog.sourceText(s)).tag(s) }
                }
            } footer: {
                if let d = data {
                    Text("Laatste 7 dagen: \(Fmt.num(d.total7d)) mails, \(Fmt.num(d.failed7d)) mislukt")
                }
            }
            Section {
                if let d = data, d.items.isEmpty {
                    Text("Geen mails gevonden.").foregroundStyle(Color.textDim)
                }
                ForEach(data?.items ?? []) { m in row(m) }
            } footer: {
                Text("Aangenomen betekent dat de mailserver de mail accepteerde, niet dat hij is aangekomen. Nieuwsbrief en mailings staan hier niet in. Alleen ontvanger en onderwerp, nooit de inhoud; na 90 dagen weg.")
            }
        }
        .scrollContentBackground(.hidden)
        .screenBackground()
        .navigationTitle("Verzonden")
        .searchable(text: $search, prompt: "Ontvanger of onderwerp")
        .refreshableCommand { await load() }
        .task(id: "\(filter)|\(source)|\(search)") {
            // zoeken met een korte pauze, zodat niet elke toetsaanslag een aanroep is
            if !search.isEmpty { try? await Task.sleep(nanoseconds: 350_000_000) }
            if Task.isCancelled { return }
            await load()
        }
    }

    private func row(_ m: MailLogItem) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(m.to).font(.subheadline.weight(.semibold)).lineLimit(1).textSelection(.enabled)
            Text(m.subject).font(.callout).lineLimit(2)
            HStack(spacing: 6) {
                Chip(text: m.resultText, tone: m.ok ? .good : .bad)
                Chip(text: MailLog.sourceText(m.source))
                Text(Fmt.dateTime(m.at)).font(.caption).foregroundStyle(Color.textSecondary)
            }
        }
        .padding(.vertical, 2)
    }

    private func load() async {
        do {
            let q = search.trimmingCharacters(in: .whitespaces)
            let j = try await session.call("mail_log", ["status": filter, "source": source.isEmpty ? nil : source,
                                                         "q": q.isEmpty ? nil : q, "limit": 200])
            data = MailLog(j)
            error = nil
        } catch let e as APIError where e.code == "server_not_configured" {
            error = "De server heeft het verzendlogboek nog niet (workflow Backend in iptv-ios-appletv)."
        } catch {
            if !(error is CancellationError) { self.error = (error as? APIError)?.errorDescription ?? APIError.text("server_error") }
        }
    }
}
