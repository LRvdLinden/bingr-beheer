import SwiftUI

/// Tab Crashes (build 171 van Bingr): groepen per handtekening met aantal, platforms, builds, eerst/laatst gezien en de status
/// (open, opgelost in build N, teruggekomen). Filter op status, platform en build; tik = details met de stacks en
/// "Opgelost in build N" / "Weer open". Zelfde gegevens als de tab Crashes van het web-dashboard (actie `crashes`).
struct CrashesView: View {
    @Environment(Session.self) private var session
    @AppStorage("crashFilter") private var filter = "all"
    @State private var platform = ""
    @State private var build = 0
    @State private var data: CrashList?
    @State private var error: String?

    private static let filters = [("all", "Alle"), ("open", "Open"), ("regressed", "Teruggekomen"), ("resolved", "Opgelost")]

    var body: some View {
        List {
            if let error { NoticeBanner(text: error).listRowBackground(Color.clear) }
            Section {
                Picker("Status", selection: $filter) {
                    ForEach(Self.filters, id: \.0) { f in Text(f.1).tag(f.0) }
                }
                .pickerStyle(.segmented)
                Picker("Platform", selection: $platform) {
                    Text("Alle platforms").tag("")
                    ForEach(data?.platforms ?? [], id: \.self) { p in Text(Fmt.platform(p)).tag(p) }
                }
                Picker("Build", selection: $build) {
                    Text("Alle builds").tag(0)
                    ForEach(data?.builds ?? [], id: \.self) { b in Text("Build \(b)").tag(b) }
                }
            } footer: {
                if let d = data {
                    Text("\(Fmt.num(d.total)) groepen · \(Fmt.num(d.open)) open · \(Fmt.num(d.regressed)) teruggekomen · \(Fmt.num(d.reports24h)) rapporten in 24 uur")
                }
            }
            Section {
                if let d = data, d.groups.isEmpty {
                    Text(filter == "all" ? "Geen crashrapporten. Mooi zo." : "Niets in dit filter.").foregroundStyle(Color.textDim)
                }
                ForEach(data?.groups ?? []) { g in
                    NavigationLink {
                        CrashDetailView(group: g, onChange: { Task { await load() } })
                    } label: { row(g) }
                }
            } footer: {
                Text("Eigen crashrapporten (geen derde partij), opgeschoond in de app en op de server; na 90 dagen weg.")
            }
        }
        .scrollContentBackground(.hidden)
        .screenBackground()
        .navigationTitle("Crashes")
        .refreshableCommand { await load() }
        .task(id: "\(filter)|\(platform)|\(build)") { await load() }
    }

    private func row(_ g: CrashGroup) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(g.signature).font(.system(.subheadline, design: .monospaced).weight(.semibold)).lineLimit(2)
            HStack(spacing: 6) {
                Chip(text: g.statusText, tone: g.tone)
                Chip(text: g.kindText)
                Text("\(Fmt.num(g.occurrences))× · \(Fmt.num(g.devices)) apparaten").font(.caption).foregroundStyle(Color.textSecondary)
            }
            Text("\(g.platforms.map { Fmt.platform($0) }.joined(separator: ", ")) · builds \(g.builds.map(String.init).joined(separator: ", ")) · laatst \(Fmt.ago(g.lastSeen))")
                .font(.caption).foregroundStyle(Color.textDim).lineLimit(2)
        }
        .padding(.vertical, 2)
    }

    private func load() async {
        do {
            let j = try await session.call("crashes", ["op": "list", "status": filter, "platform": platform.isEmpty ? nil : platform,
                                                        "build": build == 0 ? nil : build])
            data = CrashList(j)
            error = nil
        } catch let e as APIError where e.code == "server_not_configured" {
            error = "De server heeft build 171 nog niet (workflow Backend in iptv-ios-appletv)."
        } catch {
            if !(error is CancellationError) { self.error = (error as? APIError)?.errorDescription ?? APIError.text("server_error") }
        }
    }
}

struct CrashDetailView: View {
    let group: CrashGroup
    var onChange: () -> Void
    @Environment(Session.self) private var session
    @State private var detail: CrashDetail?
    @State private var buildText = ""
    @State private var busy = false

    var body: some View {
        List {
            Section {
                Text(group.signature).font(.system(.callout, design: .monospaced)).textSelection(.enabled)
                LabeledContent("Soort", value: CrashGroup.kindText(detail?.kind ?? group.kind))
                LabeledContent("Status", value: statusText)
                LabeledContent("Eerst gezien", value: Fmt.dateTime(detail?.firstSeen ?? group.firstSeen))
                LabeledContent("Laatst gezien", value: Fmt.dateTime(detail?.lastSeen ?? group.lastSeen))
            }
            Section {
                TextField("Buildnummer", text: $buildText).keyboardType(.numberPad)
                Button("Markeer als opgelost") { Task { await resolve(Int(buildText)) } }
                    .disabled(busy || Int(buildText) ?? 0 < 1)
                if (detail?.resolvedBuild ?? group.resolvedBuild) != nil {
                    Button("Weer open", role: .destructive) { Task { await resolve(nil) } }.disabled(busy)
                }
            } header: { Text("Opgelost in build") } footer: {
                Text("Komt er daarna een rapport van die build of nieuwer, dan staat hij op Teruggekomen (met een pushmelding).")
            }
            Section("Laatste rapporten") {
                ForEach(detail?.reports ?? []) { r in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(Fmt.platform(r.platform)) · \(r.appVersion ?? r.build.map { "build \($0)" } ?? "")").font(.subheadline.weight(.semibold))
                        Text([r.osVersion, r.deviceModel, Fmt.dateTime(r.at), r.count > 1 ? "\(r.count)×" : nil, r.signedIn ? nil : "niet ingelogd"]
                            .compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(Color.textDim)
                        if let m = r.message { Text(m).font(.caption) }
                        if let s = r.stack, !s.isEmpty {
                            DisclosureGroup("Stack") {
                                ScrollView(.horizontal) {
                                    Text(s).font(.system(size: 11, design: .monospaced)).textSelection(.enabled).fixedSize()
                                }
                            }.font(.caption)
                        }
                    }
                }
                if detail?.reports.isEmpty == true { Text("Geen rapporten.").foregroundStyle(Color.textDim) }
            }
        }
        .scrollContentBackground(.hidden)
        .screenBackground()
        .navigationTitle(group.kindText)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var statusText: String {
        let s = detail?.status ?? group.status, b = (detail?.resolvedBuild ?? group.resolvedBuild).map(String.init) ?? "?"
        return s == "resolved" ? "Opgelost in \(b)" : s == "regressed" ? "Teruggekomen (opgelost in \(b))" : "Open"
    }

    private func load() async {
        do {
            let j = try await session.call("crashes", ["op": "detail", "signature": group.signature, "limit": 30])
            let d = CrashDetail(j)
            detail = d
            if buildText.isEmpty { buildText = (d.resolvedBuild ?? group.builds.max().map { $0 + 1 }).map(String.init) ?? "" }
        } catch { session.report(error) }
    }

    private func resolve(_ build: Int?) async {
        busy = true
        defer { busy = false }
        do {
            try await session.call("crashes", ["op": "resolve", "signature": group.signature, "resolved_build": build])
            session.show(build.map { "Opgelost in build \($0)" } ?? "Weer open")
            await load()
            onChange()
        } catch { session.report(error) }
    }
}
