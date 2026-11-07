import SwiftUI

// Omzet: Apple (App Store Connect), zelfde als het blok "Website en Apple" in web/admin.js (renderRevSources): website
// (Stripe) en Apple (App Store) apart met het totaal, "Apple bijgewerkt t/m", hoeveel Apple-aankopen aan een account
// gekoppeld zijn, wat niet omgerekend kon worden, Apple-omzet bijwerken voor een bereik (in stukken van 31 dagen) en de
// commissie en vaste koersen. Alleen bedragen en aantallen, geen gegevens per persoon.
struct RevenueAppleCard: View {
    @Environment(Session.self) private var session
    let data: RevenueData
    let apple: RevApple
    /// opnieuw laden na bijwerken of opslaan
    let changed: () -> Void

    @State private var from = Calendar.current.date(byAdding: .day, value: -30, to: Date()) ?? Date()
    @State private var to = Calendar.current.date(byAdding: .day, value: -1, to: Date()) ?? Date()
    @State private var running: String?
    @State private var commissionText = ""
    @State private var fxText = ""
    @State private var saving = false

    private static let ymd: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Europe/Amsterdam")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                CardHeader(title: "Website en Apple", subtitle: "\(data.rangeText) · totaal = website + Apple")
                Spacer(minLength: 4)
            }
            Text(apple.text + (apple.lastRunFailed > 0 ? " · laatste ronde: \(apple.lastRunFailed) mislukt" : ""))
                .font(.caption.weight(.semibold))
                .foregroundStyle(apple.configured && apple.through != nil ? Color.white : InsColor.bad)
            table
            Text(note).font(.caption).foregroundStyle(Color.textDim)
            Divider().overlay(Color.white.opacity(0.08))
            refreshForm
            Divider().overlay(Color.white.opacity(0.08))
            settingsForm
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .onAppear {
            if commissionText.isEmpty { commissionText = RevApple.dec(apple.commission) }
            if fxText.isEmpty { fxText = apple.fxText }
        }
    }

    // MARK: tabel

    private var table: some View {
        let w = apple.web["period"], a = apple.store["period"], t = data.total("period")
        func neg(_ v: Int?) -> String { (v ?? 0) == 0 ? Fmt.euro(0) : "− \(Fmt.euro(v))" }
        func refund(_ x: RevTotals?) -> String { neg(x?.refunds) + ((x?.refundCount ?? 0) > 0 ? " (\(x!.refundCount)×)" : "") }
        return Grid(alignment: .trailing, horizontalSpacing: 10, verticalSpacing: 8) {
            GridRow {
                Text("").gridColumnAlignment(.leading)
                Text("Website").font(.caption.weight(.semibold)).foregroundStyle(Color.textSecondary)
                Text("Apple").font(.caption.weight(.semibold)).foregroundStyle(Color.textSecondary)
                Text("Totaal").font(.caption.weight(.semibold)).foregroundStyle(Color.textSecondary)
            }
            line("Bruto", hint: "klantprijs incl. btw", Fmt.euro(w?.gross), Fmt.euro(a?.gross), Fmt.euro(t?.gross))
            line("Inhouding", hint: "Stripe-kosten / Apple-commissie", neg(w?.fees), neg(a?.fees), neg(t?.fees))
            line("Netto opbrengst", hint: "na btw, inhouding en terugbetalingen", Fmt.euro(w?.proceeds), Fmt.euro(a?.proceeds), Fmt.euro(t?.proceeds), strong: true)
            line("Aantal", hint: nil, Fmt.num(w?.count), Fmt.num(a?.count), Fmt.num(t?.count))
            line("Terugbetaald", hint: "incl. btw", refund(w), refund(a), refund(t))
        }
        .monospacedDigit()
    }

    private func line(_ label: LocalizedStringKey, hint: LocalizedStringKey?, _ w: String, _ a: String, _ t: String, strong: Bool = false) -> some View {
        GridRow {
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(.subheadline.weight(strong ? .bold : .regular))
                if let hint { Text(hint).font(.caption2).foregroundStyle(Color.textDim) }
            }
            .gridColumnAlignment(.leading)
            Text(w).font(.subheadline)
            Text(a).font(.subheadline)
            Text(t).font(.subheadline.weight(.bold))
        }
    }

    private var note: String {
        let a = apple.store["period"], all = apple.store["all"]
        var s = "Apple-commissie \(RevApple.dec(apple.commission))% van de prijs zonder btw. Apple: \(Fmt.num(a?.count)) verkocht volgens de rapporten, \(Fmt.num(apple.linked)) via de app aan een account gekoppeld (totaal \(Fmt.num(all?.count)) / \(Fmt.num(apple.linkedAll)))."
        if !apple.unconvertedAll.isEmpty {
            s += " Niet omgerekend (geen koers, telt niet mee): " + apple.unconvertedAll.map { "\($0.currency) \($0.units)×" + ($0.refundUnits > 0 ? " (−\($0.refundUnits))" : "") }.joined(separator: ", ") + "."
        }
        return s
    }

    // MARK: bijwerken

    private var refreshForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Apple-omzet bijwerken").font(.subheadline.weight(.bold))
            DatePicker("Van", selection: $from, in: ...Date(), displayedComponents: .date)
            DatePicker("Tot en met", selection: $to, in: ...Date(), displayedComponents: .date)
            Button { Task { await refresh() } } label: {
                Text(running.map { "Bezig… \($0)" } ?? String(localized: "Apple-omzet bijwerken"))
            }
            .buttonStyle(.bingrGhost)
            .disabled(running != nil || !apple.configured)
            Text("Haalt de dagrapporten opnieuw op bij App Store Connect (max. 365 dagen) en overschrijft die dagen. Elke dag gebeurt dit vanzelf voor de laatste 7 dagen.")
                .font(.caption).foregroundStyle(Color.textDim)
        }
    }

    private func refresh() async {
        let f = Self.ymd.string(from: from), t = Self.ymd.string(from: to)
        guard f <= t else { session.show(APIError.text("bad_range"), bad: true); return }
        let days = (Calendar(identifier: .gregorian).dateComponents([.day], from: Self.ymd.date(from: f)!, to: Self.ymd.date(from: t)!).day ?? 0) + 1
        guard days <= 365 else { session.show(APIError.text("range_too_long"), bad: true); return }
        defer { running = nil }
        var ok = 0, empty = 0, notReady = 0, failed = 0, unauthorized = false
        var through: String? = nil
        var start = Self.ymd.date(from: f)!
        let end = Self.ymd.date(from: t)!
        do {
            while start <= end {
                let stop = min(Calendar(identifier: .gregorian).date(byAdding: .day, value: 30, to: start)!, end)
                let a = Self.ymd.string(from: start), b = Self.ymd.string(from: stop)
                running = "\(a.suffix(5)) – \(b.suffix(5))"
                let r = try await session.call("apple_sales_refresh", ["from": a, "to": b])
                if r["configured"].bool == false { session.show(APIError.text("apple_sales_not_configured"), bad: true); return }
                ok += r["ok"].int ?? 0; empty += r["empty"].int ?? 0; notReady += r["not_ready"].int ?? 0; failed += r["failed"].int ?? 0
                through = r["through"].text ?? through
                if r["error"].text == "asc_unauthorized" { unauthorized = true; break }
                start = Calendar(identifier: .gregorian).date(byAdding: .day, value: 1, to: stop)!
            }
            if unauthorized {
                session.show("App Store Connect weigert de sleutel: geef de API-sleutel de rol Sales (of Finance).", bad: true)
            } else {
                session.show("Apple-omzet bijgewerkt: \(ok) dagen met verkopen, \(empty) zonder, \(notReady) nog niet klaar\(failed > 0 ? ", \(failed) mislukt" : "")\(through.map { " (t/m \($0))" } ?? "").", bad: failed > 0)
            }
            changed()
        } catch { session.report(error) }
    }

    // MARK: commissie en koersen

    private var settingsForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Commissie en koersen").font(.subheadline.weight(.bold))
            HStack(spacing: 8) {
                Text("Apple-commissie").font(.subheadline)
                TextField("15", text: $commissionText)
                    .keyboardType(.decimalPad)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 70)
                Text("%").foregroundStyle(Color.textSecondary)
            }
            Text("Vaste koersen (EUR per 1 eenheid, één per regel)").font(.caption).foregroundStyle(Color.textSecondary)
            TextEditor(text: $fxText)
                .font(.system(.subheadline, design: .monospaced))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.characters)
                .frame(minHeight: 70)
                .scrollContentBackground(.hidden)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.06)))
            Button("Opslaan") { Task { await save() } }
                .buttonStyle(.bingrGhost)
                .disabled(saving)
        }
    }

    private func save() async {
        guard let fx = RevApple.parseFx(fxText) else { session.show(APIError.text("bad_fx_rates"), bad: true); return }
        var params: [String: Any?] = ["fx_rates": fx]
        let c = commissionText.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        if !c.isEmpty {
            guard let v = Double(c) else { session.show(APIError.text("bad_commission"), bad: true); return }
            params["commission"] = v
        }
        saving = true
        defer { saving = false }
        do {
            let r = try await session.call("revenue_apple_set", params)
            let n = r["fx_rates"].object?.count ?? 0
            commissionText = RevApple.dec(r["commission"].double ?? 15)
            session.show("Opgeslagen: commissie \(commissionText)%, \(n) \(n == 1 ? "koers" : "koersen").")
            changed()
        } catch { session.report(error) }
    }
}
