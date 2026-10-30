import Charts
import SwiftUI

/// Downloads: buildpakketten van Bingr en BingrBeheer (acties `builds` / `build_link`, zoals de tab Downloads op het web).
/// De pakketten staan alleen op de server van beheer.bingr.online (niet op GitHub). Downloaden = een link van 10 minuten
/// openen in Safari (dl.php levert het bestand als bijlage) of de link delen (bv. via AirDrop naar de Mac).
struct DownloadsView: View {
    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    @State private var overview: BuildsOverview?
    @State private var error: String?
    /// "<platform>/<bestand>" waarvoor nu een link wordt gemaakt
    @State private var busy: String?
    @State private var shareLink: BuildLink?
    /// build waarvoor de releasemelding bevestigd moet worden
    @State private var pushAsk: PushAsk?
    @State private var pushing: String?

    struct PushAsk: Identifiable {
        let platform: String
        let build: BuildInfo
        var id: String { "\(platform)/\(build.file)" }
    }

    private let columns = [GridItem(.adaptive(minimum: 320), spacing: 12, alignment: .top)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Buildpakketten van Bingr en BingrBeheer, en de PressKit. Ze staan alleen op de server van beheer.bingr.online (niet op GitHub); elke downloadlink is 10 minuten geldig.")
                    .font(.subheadline)
                    .foregroundStyle(Color.textDim)
                ReleasesCard(latest: latestBuilds)
                if let error, overview == nil {
                    NoticeBanner(text: error)
                }
                if let overview {
                    if let empty = overview.emptyText {
                        EmptyText(text: empty).card()
                    } else {
                        if let updated = overview.updated {
                            Text("Bijgewerkt \(Fmt.dateTime(updated))").font(.caption).foregroundStyle(Color.textDim)
                        }
                        LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                            ForEach(overview.platforms) { p in
                                card(p)
                            }
                        }
                        if let pk = overview.presskit {
                            presskitCard(pk)
                        }
                    }
                } else if error == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
            .padding(16)
        }
        .screenBackground()
        .navigationTitle("Downloads")
        .refreshableCommand { await load() }
        .task { if overview == nil { await load() } }
        .sheet(item: $shareLink) { link in
            BuildLinkSheet(link: link)
        }
        .confirmationDialog(pushAsk.map { "Pushmelding voor \($0.build.title) versturen?" } ?? "",
                            isPresented: Binding(get: { pushAsk != nil }, set: { if !$0 { pushAsk = nil } }),
                            titleVisibility: .visible, presenting: pushAsk) { a in
            Button("Versturen naar \(ReleasePushState.audience[a.platform] ?? a.platform)") {
                Task { await sendPush(a.platform, a.build) }
            }
            Button("Annuleren", role: .cancel) {}
        } message: { a in
            Text("Doe dit pas als \(a.build.title) goedgekeurd is en in de stores staat. Alleen apparaten met een oudere build krijgen de melding, en dit kan maar één keer per build.")
        }
    }

    /// Nieuwste build van Apple en Android voor "Neem nieuwste build" op de kaart Versies.
    private var latestBuilds: [String: BuildInfo] {
        var out: [String: BuildInfo] = [:]
        for p in overview?.platforms ?? [] where p.key == "apple" || p.key == "android" {
            if let b = p.latest { out[p.key] = b }
        }
        return out
    }

    @ViewBuilder private func card(_ p: BuildPlatform) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: p.icon)
                    .font(.title3)
                    .foregroundStyle(Color.textSecondary)
                    .frame(width: 28)
                CardHeader(title: p.title, subtitle: p.hint)
                Spacer(minLength: 8)
                if let b = p.latest { Chip(text: b.title) }
            }
            if let b = p.latest {
                VStack(alignment: .leading, spacing: 6) {
                    InfoRow("Versie", b.version ?? "—")
                    InfoRow("Build", b.build ?? "—")
                    InfoRow(b.uploadedAt == nil ? "Datum" : "Geüpload", b.when ?? "—")
                    InfoRow("Grootte", BuildInfo.sizeText(b.size))
                    InfoRow(label: "Bestand") {
                        Text(verbatim: b.file).textSelection(.enabled)
                    }
                    if let hash = b.sha256 {
                        InfoRow(label: "SHA-256") {
                            Text(verbatim: hash)
                                .font(.caption.monospaced())
                                .foregroundStyle(Color.textSecondary)
                                .textSelection(.enabled)
                        }
                    }
                }
                if let notes = b.notes {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Notities").font(.caption).foregroundStyle(Color.textDim)
                        // kopjes (Nieuw / Verbeterd / Opgelost) en opsommingen; geen HTML of links
                        BuildNotesView(text: notes)
                            .padding(12)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.surface2))
                    }
                }
                if p.key == "windows", let pub = overview?.windowsPublic {
                    publicDownloadRow(pub, build: b.build)
                }
                buttons(p.key, b, primary: true)
                if ReleasePushState.audience[p.key] != nil {
                    pushRow(p.key, b, compact: false)
                    Text("Pushmelding pas versturen als deze build in de stores staat. Alleen apparaten met een oudere build krijgen hem, één keer per build.")
                        .font(.caption)
                        .foregroundStyle(Color.textDim)
                }
                if !p.history.isEmpty {
                    Divider().overlay(Color.line)
                    Text("Oudere builds").font(.caption).foregroundStyle(Color.textDim)
                    ForEach(p.history) { h in
                        HStack(alignment: .center, spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(h.title).font(.subheadline.weight(.semibold))
                                if !h.detail.isEmpty {
                                    Text(h.detail).font(.caption).foregroundStyle(Color.textDim)
                                }
                            }
                            Spacer(minLength: 8)
                            if ReleasePushState.audience[p.key] != nil { pushRow(p.key, h, compact: true) }
                            buttons(p.key, h, primary: false)
                        }
                    }
                }
            } else {
                EmptyText(text: "Nog geen build op de server.")
            }
        }
        .card()
    }

    /// Kaart PressKit: versie, datum, grootte, downloads (totaal, deze versie, 7 en 30 dagen, grafiekje), downloaden en de
    /// openbare link (bingr.online/presskit) om te kopiëren of te delen.
    @ViewBuilder private func presskitCard(_ pk: PresskitOverview) -> some View {
        let b = pk.build
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "newspaper")
                    .font(.title3)
                    .foregroundStyle(Color.textSecondary)
                    .frame(width: 28)
                CardHeader(title: "PressKit", subtitle: "Persmap voor bingr.online: logo, app-iconen en App Store-screenshots (Bingr-PressKit.zip)")
                Spacer(minLength: 8)
                Chip(text: "versie \(b.version ?? "—")")
            }
            VStack(alignment: .leading, spacing: 6) {
                InfoRow("Versie", b.version ?? "—")
                InfoRow(b.uploadedAt == nil ? "Datum" : "Geüpload", b.when ?? "—")
                InfoRow("Grootte", BuildInfo.sizeText(b.size))
                InfoRow(label: "Bestand") { Text(verbatim: b.file).textSelection(.enabled) }
            }
            if let total = pk.total {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 12, alignment: .leading)], alignment: .leading, spacing: 12) {
                    stat(total, "Downloads totaal")
                    stat(pk.versionTotal, "Deze versie")
                    stat(pk.last7, "Laatste 7 dagen")
                    stat(pk.last30, "Laatste 30 dagen")
                }
                if !pk.days.isEmpty {
                    Chart(pk.days) { d in
                        BarMark(x: .value("Dag", d.date, unit: .day), y: .value("Downloads", d.count))
                            .foregroundStyle(Color.bingrRed)
                    }
                    .chartYAxis(.hidden)
                    .chartXAxis {
                        AxisMarks(values: .stride(by: .day, count: 7)) { _ in
                            AxisValueLabel(format: .dateTime.day().month(.abbreviated))
                        }
                    }
                    .frame(height: 80)
                    .accessibilityLabel("Downloads per dag, laatste 30 dagen: \(Fmt.num(pk.last30)) in totaal")
                }
            } else {
                Text("Nog geen tellingen (teller nog niet op de server).").font(.caption).foregroundStyle(Color.textDim)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Openbare link (zonder inloggen; telt als download)").font(.caption).foregroundStyle(Color.textDim)
                HStack(spacing: 8) {
                    Text(verbatim: pk.publicURL.absoluteString)
                        .font(.subheadline)
                        .textSelection(.enabled)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button {
                        UIPasteboard.general.url = pk.publicURL
                        session.show("Link gekopieerd.")
                    } label: {
                        Image(systemName: "doc.on.doc")
                    }
                    .buttonStyle(.bingrGhost)
                    .accessibilityLabel("Openbare link kopiëren")
                    ShareLink(item: pk.publicURL) { Image(systemName: "square.and.arrow.up") }
                        .buttonStyle(.bingrGhost)
                        .accessibilityLabel("Openbare link delen")
                }
            }
            buttons("presskit", b, primary: true)
        }
        .card()
    }

    /// Openbare download (Windows-testversie via bingr.online/windows): teller per build en de link om te kopiëren of te delen.
    @ViewBuilder private func publicDownloadRow(_ pub: PublicDownloadStats, build: String?) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let total = pub.total {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 12, alignment: .leading)], alignment: .leading, spacing: 12) {
                    stat(total, "Openbare downloads")
                    stat(pub.buildTotal, "Build \(build ?? "—")")
                    stat(pub.last7, "Laatste 7 dagen")
                    stat(pub.last30, "Laatste 30 dagen")
                }
            } else {
                Text("Nog geen tellingen (teller nog niet op de server).").font(.caption).foregroundStyle(Color.textDim)
            }
            Text("Openbare link (testversie, zonder inloggen; telt als download)").font(.caption).foregroundStyle(Color.textDim)
            HStack(spacing: 8) {
                Text(verbatim: pub.publicURL.absoluteString)
                    .font(.subheadline)
                    .textSelection(.enabled)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    UIPasteboard.general.url = pub.publicURL
                    session.show("Link gekopieerd.")
                } label: {
                    Image(systemName: "doc.on.doc")
                }
                .buttonStyle(.bingrGhost)
                .accessibilityLabel("Openbare link kopiëren")
                ShareLink(item: pub.publicURL) { Image(systemName: "square.and.arrow.up") }
                    .buttonStyle(.bingrGhost)
                    .accessibilityLabel("Openbare link delen")
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.surface2))
    }

    private func stat(_ n: Int, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(Fmt.num(n)).font(.title2.weight(.heavy)).monospacedDigit()
            Text(label).font(.caption).foregroundStyle(Color.textDim)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func buttons(_ platform: String, _ b: BuildInfo, primary: Bool) -> some View {
        let isBusy = busy == "\(platform)/\(b.file)"
        let download = Button {
            Task { await makeLink(platform, b, share: false) }
        } label: {
            HStack(spacing: 6) {
                if isBusy {
                    ProgressView().tint(.white)
                } else {
                    Image(systemName: "arrow.down.circle")
                }
                Text("Downloaden")
            }
        }
        HStack(spacing: 8) {
            if primary {
                download.buttonStyle(.bingr)
            } else {
                download.buttonStyle(.bingrGhost)
            }
            Button {
                Task { await makeLink(platform, b, share: true) }
            } label: {
                Image(systemName: "square.and.arrow.up")
            }
            .buttonStyle(.bingrGhost)
            .accessibilityLabel("Downloadlink delen")
        }
        .disabled(busy != nil)
    }

    /// Knop "Pushmelding versturen", of "Push verstuurd" met datum en aantallen als hij al verstuurd is.
    @ViewBuilder private func pushRow(_ platform: String, _ b: BuildInfo, compact: Bool) -> some View {
        if let build = b.build {
            if let st = overview?.pushes["\(platform):\(build)"] {
                if compact {
                    Image(systemName: "bell.badge.fill")
                        .foregroundStyle(Color.green)
                        .accessibilityLabel("Pushmelding verstuurd \(Fmt.dateTime(st.sentAt)): \(st.counts)")
                } else {
                    Label("Push verstuurd \(Fmt.dateTime(st.sentAt)) · \(st.counts)", systemImage: "bell.badge.fill")
                        .font(.subheadline)
                        .foregroundStyle(Color.green)
                }
            } else {
                let isBusy = pushing == "\(platform)/\(b.file)"
                let button = Button {
                    pushAsk = PushAsk(platform: platform, build: b)
                } label: {
                    HStack(spacing: 6) {
                        if isBusy { ProgressView().tint(.white) } else { Image(systemName: "bell") }
                        if !compact { Text("Pushmelding versturen") }
                    }
                }
                .disabled(pushing != nil)
                .accessibilityLabel("Pushmelding versturen voor \(b.title)")
                button.buttonStyle(.bingrGhost)
            }
        }
    }

    private func sendPush(_ platform: String, _ b: BuildInfo) async {
        pushing = "\(platform)/\(b.file)"
        defer { pushing = nil }
        do {
            let r = try await session.call("build_push", ["platform": platform, "file": b.file])
            let build = r["build"].text ?? b.build ?? ""
            let missing = r["missing_channels"].array.compactMap { $0.text }.map { PushCounts.note($0) }
            if r["duplicate"].bool == true {
                session.show("De pushmelding voor build \(build) was al eerder verstuurd.")
            } else {
                let base = "Pushmelding build \(build) verstuurd naar \(Fmt.num(r["devices"].int ?? 0)) apparaten."
                session.show(missing.isEmpty ? base : "\(base) Let op: \(missing.joined(separator: ", ")).", bad: !missing.isEmpty)
            }
            if r["push"].object != nil { overview?.pushes["\(platform):\(build)"] = ReleasePushState(r["push"]) }
            await load()
        } catch {
            session.report(error)
            if (error as? APIError)?.code == "build_not_found" { await load() }
        }
    }

    private func load() async {
        do {
            let r = try await session.call("builds")
            overview = BuildsOverview(r)
            error = nil
        } catch {
            if error is CancellationError { return }
            self.error = (error as? APIError)?.errorDescription ?? APIError.text("server_error")
            session.report(error)
        }
    }

    private func makeLink(_ platform: String, _ b: BuildInfo, share: Bool) async {
        busy = "\(platform)/\(b.file)"
        defer { busy = nil }
        do {
            let r = try await session.call("build_link", ["platform": platform, "file": b.file])
            guard let link = BuildLink(r) else {
                session.show(APIError.text("server_error"), bad: true)
                return
            }
            if share {
                shareLink = link
            } else {
                openURL(link.url)
                session.show("Download geopend in \(Platform.isMac ? "je browser" : "Safari"): \(link.file)")
            }
        } catch {
            session.report(error)
            // de build is intussen van de server: lijst opnieuw laden
            if (error as? APIError)?.code == "build_not_found" { await load() }
        }
    }
}

/// Downloadlink (10 minuten geldig) om te delen, te kopiëren of in Safari te openen.
struct BuildLinkSheet: View {
    let link: BuildLink
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Bestand", value: link.file)
                    LabeledContent("Grootte", value: BuildInfo.sizeText(link.size))
                    LabeledContent("Geldig tot", value: Fmt.time(link.expiresAt))
                } footer: {
                    Text(Platform.isMac
                         ? "Iedereen met deze link kan het bestand ophalen tot hij verloopt. Deel hem alleen met jezelf. Openen downloadt het bestand in je standaardbrowser (map Downloads)."
                         : "Iedereen met deze link kan het bestand ophalen tot hij verloopt. Deel hem alleen met jezelf, bijvoorbeeld via AirDrop naar je Mac.")
                }
                Section {
                    ShareLink(item: link.url, subject: Text(verbatim: link.file)) {
                        Label("Link delen", systemImage: "square.and.arrow.up")
                    }
                    Button {
                        UIPasteboard.general.url = link.url
                        dismiss()
                    } label: {
                        Label("Link kopiëren", systemImage: "doc.on.doc")
                    }
                    Button {
                        openURL(link.url)
                        dismiss()
                    } label: {
                        Label(Platform.isMac ? "Openen in browser" : "Openen in Safari", systemImage: "safari")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .screenBackground()
            .navigationTitle("Downloadlink")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Klaar") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
