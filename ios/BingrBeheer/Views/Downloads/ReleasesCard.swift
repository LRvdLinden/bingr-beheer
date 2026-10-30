import SwiftUI

/// Kaart "Versies op bingr.online" (tab Downloads, zoals de kaart Versies op het web): per platform welke versie live
/// staat (App Store, Google Play) en welke bèta het nieuwst is (TestFlight, APK). Acties `releases_get` / `releases_set`
/// (app_settings.release_channels; openbaar via de functie status, ?action=releases). bingr.online toont het als rode
/// badge bij de downloadknoppen. "Neem nieuwste build" vult de bèta met de nieuwste build uit het manifest.
struct ReleasesCard: View {
    /// Nieuwste build per platform uit het manifest (actie `builds`), sleutel "apple" / "android".
    let latest: [String: BuildInfo]

    @Environment(Session.self) private var session
    @State private var fields: [String: Fields] = [:]
    @State private var updatedAt: Date?
    @State private var loaded = false
    @State private var loadError: String?
    @State private var saving = false

    struct Fields: Equatable {
        var version = ""
        var build = ""
        var date = ""
        var label = ""
    }

    struct Plat: Identifiable {
        let key: String, title: String, hint: String, live: String, beta: String
        var id: String { key }
    }

    /// Volgorde en teksten zoals REL_PLATFORMS in web/admin.js.
    static let platforms: [Plat] = [
        Plat(key: "apple", title: "Apple", hint: "iPhone, iPad, Apple TV en Mac", live: "App Store", beta: "TestFlight"),
        Plat(key: "android", title: "Android", hint: "Telefoons, tablets, Android TV, Google TV en Fire TV", live: "Google Play", beta: "APK"),
    ]
    static let labels = ["TestFlight", "Beta"]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "Versies op bingr.online",
                       subtitle: "Welke versie live staat (App Store, Google Play) en welke bèta het nieuwst is (TestFlight, APK). De site toont het als rode badge bij de downloadknoppen. Laat versie en build leeg om een badge te verbergen.")
            if let loadError, !loaded {
                NoticeBanner(text: loadError)
            } else if !loaded {
                ProgressView().frame(maxWidth: .infinity)
            } else {
                ForEach(Self.platforms) { p in
                    platform(p)
                }
                HStack(spacing: 12) {
                    Button {
                        Task { await save() }
                    } label: {
                        if saving { ProgressView() } else { Text("Opslaan").fontWeight(.semibold) }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.bingrRed)
                    .disabled(saving)
                    if let updatedAt {
                        Text("Laatst opgeslagen \(Fmt.dateTime(updatedAt))").font(.caption).foregroundStyle(Color.textDim)
                    }
                }
            }
        }
        .card()
        .task { if !loaded { await load() } }
    }

    @ViewBuilder private func platform(_ p: Plat) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                CardHeader(title: p.title, subtitle: p.hint)
                Spacer(minLength: 8)
                Button("Neem nieuwste build") { takeLatest(p.key) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(latest[p.key]?.build == nil)
            }
            channel(p.key, "live", title: "Live", store: p.live)
            channel(p.key, "beta", title: "Bèta", store: p.beta)
            HStack(spacing: 8) {
                Text("Op de site:").font(.caption).foregroundStyle(Color.textDim)
                if preview(p.key).isEmpty {
                    Text("Geen badge").font(.caption).foregroundStyle(Color.textDim)
                } else {
                    ForEach(preview(p.key), id: \.self) { ReleaseBadge(text: $0) }
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.surface2))
    }

    @ViewBuilder private func channel(_ p: String, _ kind: String, title: String, store: String) -> some View {
        let key = "\(p).\(kind)"
        VStack(alignment: .leading, spacing: 6) {
            (Text(title.uppercased()).fontWeight(.bold) + Text(" (\(store))").foregroundColor(Color.textDim))
                .font(.caption)
                .foregroundStyle(Color.textSecondary)
            HStack(spacing: 8) {
                TextField("Versie, bijv. 1.0.3", text: binding(key, \.version))
                    .keyboardType(.decimalPad)
                TextField("Build, bijv. 154", text: binding(key, \.build))
                    .keyboardType(.numberPad)
            }
            .textFieldStyle(.roundedBorder)
            HStack(spacing: 8) {
                TextField("Datum (optioneel, JJJJ-MM-DD)", text: binding(key, \.date))
                    .keyboardType(.numbersAndPunctuation)
                    .textFieldStyle(.roundedBorder)
                if kind == "beta" {
                    Picker("Label", selection: binding(key, \.label)) {
                        ForEach(Self.labels, id: \.self) { Text($0).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 220)
                }
            }
        }
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
    }

    private func binding(_ key: String, _ path: WritableKeyPath<Fields, String>) -> Binding<String> {
        Binding(get: { fields[key, default: Fields()][keyPath: path] },
                set: { fields[key, default: Fields()][keyPath: path] = $0 })
    }

    private static func defaultLabel(_ p: String) -> String { p == "apple" ? "TestFlight" : "Beta" }

    /// Badges zoals de site ze toont, bijv. "Live 1.0.2 (152)" en "TestFlight 1.0.3 (154)".
    private func preview(_ p: String) -> [String] {
        var out: [String] = []
        for kind in ["live", "beta"] {
            let f = fields["\(p).\(kind)", default: Fields()]
            let v = f.version.trimmingCharacters(in: .whitespaces), b = f.build.trimmingCharacters(in: .whitespaces)
            guard !v.isEmpty, !b.isEmpty else { continue }
            let label = kind == "live" ? "Live" : (f.label.isEmpty ? Self.defaultLabel(p) : f.label)
            out.append("\(label) \(v) (\(b))")
        }
        return out
    }

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Europe/Amsterdam")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private func takeLatest(_ p: String) {
        guard let b = latest[p], let build = b.build else {
            session.show("Geen build in het manifest voor dit platform (vernieuw Downloads).", bad: true)
            return
        }
        var f = fields["\(p).beta", default: Fields()]
        f.version = b.version ?? ""
        f.build = build
        f.date = (b.uploadedAt ?? b.date).map { Self.dayFormatter.string(from: $0) } ?? ""
        if f.label.isEmpty { f.label = Self.defaultLabel(p) }
        fields["\(p).beta"] = f
        session.show("Bèta ingevuld met build \(build). Vergeet niet op te slaan.")
    }

    private func load() async {
        do {
            let r = try await session.call("releases_get")
            let rel = r["releases"]
            var out: [String: Fields] = [:]
            for p in Self.platforms {
                for kind in ["live", "beta"] {
                    let c = rel[p.key][kind]
                    out["\(p.key).\(kind)"] = Fields(version: c["version"].text ?? "", build: c["build"].text ?? "",
                                                     date: c["date"].text ?? "",
                                                     label: kind == "beta" ? (c["label"].text ?? Self.defaultLabel(p.key)) : "")
                }
            }
            fields = out
            updatedAt = rel["updatedAt"].date
            loaded = true
            loadError = nil
        } catch {
            if error is CancellationError { return }
            loadError = (error as? APIError)?.errorDescription ?? APIError.text("server_error")
            session.report(error)
        }
    }

    private func save() async {
        var releases: [String: Any] = [:]
        for p in Self.platforms {
            var plat: [String: Any] = [:]
            for kind in ["live", "beta"] {
                let f = fields["\(p.key).\(kind)", default: Fields()]
                var c: [String: Any] = [
                    "version": f.version.trimmingCharacters(in: .whitespaces),
                    "build": f.build.trimmingCharacters(in: .whitespaces),
                    "date": f.date.trimmingCharacters(in: .whitespaces),
                ]
                if kind == "beta" { c["label"] = f.label }
                plat[kind] = c
            }
            releases[p.key] = plat
        }
        saving = true
        defer { saving = false }
        do {
            try await session.call("releases_set", ["releases": releases])
            session.show("Versies opgeslagen. bingr.online toont ze binnen een paar minuten.")
            await load()
        } catch {
            session.report(error)
        }
    }
}

/// Rode badge zoals op bingr.online (pil met rand en stip).
struct ReleaseBadge: View {
    let text: String

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(Color.bingrRed).frame(width: 6, height: 6)
            Text(text).font(.caption.weight(.bold)).monospacedDigit()
        }
        .lineLimit(1)
        .padding(.horizontal, 10)
        .padding(.vertical, 3)
        .foregroundStyle(Color.white)
        .background(Capsule().fill(Color.bingrRed.opacity(0.15)))
        .overlay(Capsule().strokeBorder(Color.bingrRed.opacity(0.6), lineWidth: 1))
    }
}
