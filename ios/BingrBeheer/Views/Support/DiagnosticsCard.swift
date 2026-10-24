import SwiftUI

/// Diagnose-bijlage bij een bericht uit de app (build 146): samenvatting als kop, uitklapbaar met apparaat, app-status,
/// netwerk, opslag en geheugen, mijlpalen bij het starten en de laatste crash. Nooit als ruwe JSON.
/// Build 147 (schema 2): probleem bij de vorige start bovenaan in rood, de start als gekleurd label, ophalen per server en
/// soort, opslag met totaal en een knop Kopiëren (hele diagnose als tekst). Schema 1 blijft zoals in build 146.
struct DiagnosticsCard: View {
    let diag: TicketDiagnostics
    @Environment(Session.self) private var session
    @State private var open: Bool

    init(diag: TicketDiagnostics) {
        self.diag = diag
        _open = State(initialValue: diag.hasCrash || diag.hasPreviousProblem || diag.startSummary == "hung")
    }

    /// Eén regel label/waarde (alleen als er een waarde is).
    struct Row: Identifiable {
        let id: String
        let value: String
        var tone: Tone? = nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if diag.hasPreviousProblem { previousAlert }
            card
        }
    }

    /// Probleem bij de vorige start (hang, crash, niet klaar) in rood, met fase, duur, voorgrond en taak.
    private var previousAlert: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label("Probleem bij de vorige start: " + (TicketDiagnostics.problemLabel(diag.prevProblem) ?? ""), systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(Color.stateDown)
            if let d = diag.previousProblemDetail, !d.isEmpty {
                Text(d).font(.caption).foregroundStyle(Color.bad)
            }
            if !diag.prevStack.isEmpty { stackText(diag.prevStack) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.stateDown.opacity(0.14)))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.stateDown.opacity(0.45)))
        .accessibilityElement(children: .combine)
    }

    private var card: some View {
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: 12) {
                Button {
                    UIPasteboard.general.string = diag.plainText
                    session.show("Diagnose gekopieerd.")
                } label: {
                    Label("Kopiëren", systemImage: "doc.on.doc")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                block("Apparaat", deviceRows)
                if diag.hasStart { block("Start", startRows) }
                block("App", appRows)
                if !diag.fetch.isEmpty { fetchView }
                block("Netwerk", networkRows)
                if diag.hasStorage2 {
                    block("Opslag", storage2Rows)
                    block("Geheugen", memoryRows)
                } else {
                    block("Opslag en geheugen", storageRows)
                }
                if !diag.milestones.isEmpty { milestonesView }
                if diag.hasCrash { crashView }
            }
            .padding(.top, 8)
        } label: {
            HStack(spacing: 6) {
                Chip(text: "Diagnose", icon: "stethoscope")
                if let s = diag.startLabel { Chip(text: s.0, tone: s.1) }
                Text(diag.summary).font(.caption).foregroundStyle(Color.textSecondary).lineLimit(2)
                if diag.hasCrash { Chip(text: "crash", tone: .bad) }
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.black.opacity(0.18)))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.white.opacity(0.08)))
    }

    // MARK: rijen

    private var deviceRows: [Row] {
        var r: [Row] = []
        add(&r, "Soort", diag.deviceType.map(Labels.deviceType))
        add(&r, "Model", diag.model)
        add(&r, "Fabrikant", diag.manufacturer)
        add(&r, "Systeem", diag.systemLine)
        add(&r, "Taal", diag.language)
        add(&r, "Browser", diag.browser)
        add(&r, "Scherm", diag.screen)
        add(&r, "App", diag.appLine)
        add(&r, "Speler", diag.engine)
        if let d = diag.createdAt { add(&r, "Gemaakt", Fmt.dateTime(d)) }
        return r
    }

    private var appRows: [Row] {
        var r: [Row] = []
        add(&r, "Ingelogd", yesNo(diag.signedIn))
        if let p = diag.plan { add(&r, "Abonnement", p == "lifetime" ? "Lifetime" : p == "free" ? "Gratis" : p) }
        if let n = diag.profiles { add(&r, "Profielen", Fmt.num(n)) }
        if let n = diag.servers {
            let kinds = diag.serverKinds.isEmpty ? "" : " (" + diag.serverKinds.joined(separator: ", ") + ")"
            add(&r, "Servers", Fmt.num(n) + kinds)
        }
        if diag.channels != nil || diag.movies != nil || diag.series != nil {
            let parts: [String] = [diag.channels, diag.movies, diag.series].map { v in v.map { Fmt.num($0) } ?? "–" }
            add(&r, "Zenders / films / series", parts.joined(separator: " / "))
        }
        if let d = diag.lastSync { add(&r, "Laatste sync", Fmt.ago(d) + (diag.lastSyncOk == false ? " (mislukt)" : "")) }
        add(&r, "Pushmeldingen", yesNo(diag.pushEnabled))
        if let s = diag.uptimeS { add(&r, "Draait al", duration(Double(s))) }
        return r
    }

    private var networkRows: [Row] {
        var r: [Row] = []
        add(&r, "Online", yesNo(diag.online))
        if let t = diag.netType { add(&r, "Verbinding", Labels.netType(t)) }
        if let b = diag.backend { r.append(checkRow("Bingr-server", b, diag.backendMs)) }
        if let p = diag.provider { r.append(checkRow("IPTV-provider", p, diag.providerMs)) }
        add(&r, "VPN", yesNo(diag.vpn))
        return r
    }

    private var storageRows: [Row] {
        var r: [Row] = []
        add(&r, "Opslag gebruikt", mb(diag.storageUsedMB))
        add(&r, "Vrij", mb(diag.storageFreeMB))
        add(&r, "Cache", mb(diag.cacheMB))
        add(&r, "Database", mb(diag.dbMB))
        if let used = mb(diag.memUsedMB) {
            let total = mb(diag.memTotalMB).map { " van " + $0 } ?? ""
            add(&r, "Geheugen", used + total)
        }
        add(&r, "Door Bingr", mb(diag.memAppMB))
        add(&r, "Weinig geheugen", yesNo(diag.lowMemory))
        return r
    }

    // build 147
    private var startRows: [Row] {
        var r: [Row] = []
        if let s = diag.startLabel { r.append(Row(id: "Samenvatting", value: s.0, tone: s.1)) }
        add(&r, "App-tijd", diag.appMs.map { ms($0) })
        add(&r, "Wachten op gebruiker", diag.userWaitMs.map { ms($0) })
        add(&r, "Langste hang", diag.maxHangMs.map { ms($0) })
        if let p = diag.prevProblem {
            add(&r, "Vorige start", p == "none" ? "geen probleem" : (TicketDiagnostics.problemLabel(p) ?? p))
        }
        return r
    }

    private var storage2Rows: [Row] {
        var r: [Row] = []
        add(&r, "Totaal (Bingr)", mb(diag.totalMB))
        add(&r, "Cache", mb(diag.cacheMB))
        add(&r, "Catalogus", mb(diag.catalogMB))
        add(&r, "Downloads", mb(diag.downloadsMB))
        add(&r, "Vrij op het apparaat", mb(diag.storageFreeMB))
        return r
    }

    private var memoryRows: [Row] {
        var r: [Row] = []
        if let used = mb(diag.memUsedMB) {
            let total = mb(diag.memTotalMB).map { " van " + $0 } ?? ""
            add(&r, "Geheugen", used + total)
        }
        add(&r, "Door Bingr", mb(diag.memAppMB))
        add(&r, "Weinig geheugen", yesNo(diag.lowMemory))
        return r
    }

    private var fetchView: some View {
        VStack(alignment: .leading, spacing: 4) {
            header("Ophalen per server en soort")
            ForEach(diag.fetch) { f in
                HStack(spacing: 6) {
                    Chip(text: f.server)
                    Chip(text: TicketDiagnostics.fetchText(f), tone: TicketDiagnostics.fetchTone(f.status))
                }
            }
        }
    }

    private func stackText(_ lines: [String]) -> some View {
        ScrollView(.horizontal) {
            Text(lines.joined(separator: "\n"))
                .font(.caption2.monospaced())
                .textSelection(.enabled)
                .padding(8)
        }
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.black.opacity(0.3)))
    }

    private func add(_ rows: inout [Row], _ label: String, _ value: String?) {
        if let value, !value.isEmpty { rows.append(Row(id: label, value: value)) }
    }

    private func checkRow(_ label: String, _ k: String, _ ms: Int?) -> Row {
        let (text, tone) = Labels.check(k)
        return Row(id: label, value: ms.map { text + " · " + self.ms($0) } ?? text, tone: tone)
    }

    // MARK: onderdelen

    @ViewBuilder private func block(_ title: String, _ rows: [Row]) -> some View {
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                header(title)
                ForEach(rows) { row in
                    InfoRow(label: row.id) {
                        if let tone = row.tone {
                            Chip(text: row.value, tone: tone)
                        } else {
                            Text(row.value)
                        }
                    }
                }
            }
        }
    }

    private var milestonesView: some View {
        VStack(alignment: .leading, spacing: 4) {
            header("Mijlpalen bij het starten")
            ForEach(diag.milestones) { m in
                HStack {
                    Text(TicketDiagnostics.milestoneName(m.name)).font(.caption.monospaced())
                    Spacer()
                    if m.ok == false { Chip(text: "mislukt", tone: .bad) }
                    Text(m.ms.map { ms($0) } ?? "").font(.caption).foregroundStyle(Color.textDim)
                }
            }
        }
    }

    private var crashView: some View {
        var rows: [Row] = []
        if let d = diag.crashAt { add(&rows, "Wanneer", Fmt.dateTime(d)) }
        add(&rows, "Soort", diag.crashType)
        add(&rows, "Reden", diag.crashReason)
        add(&rows, "Build", diag.crashBuild.map { String($0) })
        return VStack(alignment: .leading, spacing: 6) {
            block("Laatste crash", rows)
            if !diag.crashStack.isEmpty {
                ScrollView(.horizontal) {
                    Text(diag.crashStack.joined(separator: "\n"))
                        .font(.caption2.monospaced())
                        .textSelection(.enabled)
                        .padding(8)
                }
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.black.opacity(0.3)))
            }
        }
    }

    private func header(_ t: String) -> some View {
        Text(t.uppercased()).font(.caption2.weight(.bold)).foregroundStyle(Color.textDim)
    }

    private func yesNo(_ b: Bool?) -> String? { b.map { $0 ? "ja" : "nee" } }
    private func mb(_ v: Double?) -> String? {
        guard let v else { return nil }
        if v >= 1024 { return String(format: "%.1f GB", v / 1024).replacingOccurrences(of: ".", with: ",") }
        return Fmt.num(Int(v.rounded())) + " MB"
    }
    private func ms(_ v: Int) -> String {
        v >= 1000 ? String(format: "%.1f s", Double(v) / 1000).replacingOccurrences(of: ".", with: ",") : "\(v) ms"
    }
    private func duration(_ s: Double) -> String {
        if s >= 3600 { return String(format: "%.1f uur", s / 3600).replacingOccurrences(of: ".", with: ",") }
        return s >= 60 ? "\(Int(s / 60)) min" : "\(Int(s)) s"
    }
}
