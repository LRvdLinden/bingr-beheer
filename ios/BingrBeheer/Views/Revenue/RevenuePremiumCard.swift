import SwiftUI

/// Build 181: blok "Abonnementen (Premium)" op de omzetpagina (zoals loadRevPremium in web/admin.js): dezelfde totalen als
/// Premium (actie premium_stats), Stripe en Apple apart. Alleen totalen.
struct RevenuePremiumCard: View {
    @Environment(Session.self) private var session
    /// telt op bij Vernieuwen van de omzetpagina
    let revision: Int
    @State private var stats: PremiumStats?
    @State private var note: String?

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 10)]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "Abonnementen (Premium)", subtitle: "MRR: maand ×1, halfjaar ÷6, jaar ÷12")
            if let s = stats {
                LazyVGrid(columns: columns, alignment: .leading, spacing: 10) { tiles(s) }
                ForEach(s.by) { r in
                    HStack(alignment: .firstTextBaseline) {
                        Text(r.title).font(.subheadline.weight(.semibold))
                        Spacer(minLength: 8)
                        Text(r.detail).font(.caption).foregroundStyle(Color.textSecondary).multilineTextAlignment(.trailing)
                    }
                }
            } else if let note {
                EmptyText(text: note)
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .task(id: revision) { await load() }
    }

    @ViewBuilder private func tiles(_ s: PremiumStats) -> some View {
        let sp = s.provider("stripe")
        let ap = s.provider("apple")
        KPITile(label: "MRR", value: Fmt.euro(s.mrr), small: true)
        KPITile(label: "Stripe", value: Fmt.num(sp.active) + " actief", hint: Fmt.num(sp.trialing) + " in proef · " + Fmt.euro(sp.mrr) + " MRR", small: true)
        KPITile(label: "Apple", value: Fmt.num(ap.active) + " actief", hint: Fmt.num(ap.trialing) + " in proef · " + Fmt.euro(ap.mrr) + " MRR", small: true)
        KPITile(label: "Proeven", value: Fmt.num(s.trialsStarted), hint: Fmt.num(s.trialsConverted) + " omgezet", small: true)
        KPITile(label: "Opgezegd", value: Fmt.num(s.canceled), hint: Fmt.num(s.expired30d) + " verlopen (30 d)", small: true)
        KPITile(label: "Stripe-omzet abonnementen", value: Fmt.euro(s.liveNet), hint: "live, na terugbetalingen", small: true)
    }

    private func load() async {
        do {
            stats = PremiumStats(try await session.call("premium_stats"))
            note = nil
        } catch let e as APIError where e.code == "premium_not_configured" {
            note = "Nog niet ingericht (workflow Backend)."
        } catch {
            if stats == nil { note = (error as? APIError)?.code == "auth" ? "" : error.localizedDescription }
        }
    }
}
