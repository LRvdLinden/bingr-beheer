import SwiftUI

/// Instellingen van één widget: grootte en de getoonde gegevens van het type.
struct DashWidgetSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: DashWidget
    let title: String
    let knownPlatforms: [String]
    let onSave: (DashWidget) -> Void

    init(widget: DashWidget, title: String, knownPlatforms: [String], onSave: @escaping (DashWidget) -> Void) {
        _draft = State(initialValue: widget)
        self.title = title
        self.knownPlatforms = knownPlatforms
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Grootte", selection: $draft.size) {
                        ForEach(draft.type.sizes) { z in Text("\(z.name) \(z.dims)").tag(z) }
                    }
                    .pickerStyle(.segmented)
                } header: {
                    Text("Grootte")
                } footer: {
                    Text(draft.type.summary)
                }
                options
                Section {
                    Button("Standaard voor deze widget") {
                        draft = DashWidget(id: draft.id, type: draft.type, hidden: draft.hidden)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.surface1)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuleer") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Bewaar") {
                        onSave(DashWidget(id: draft.id, type: draft.type, size: draft.size, hidden: draft.hidden, options: draft.options))
                        dismiss()
                    }
                    .bold()
                }
            }
        }
    }

    @ViewBuilder private var options: some View {
        switch draft.type {
        case .metric:
            Section("Gegevens") {
                Picker("Getal", selection: value(\.metric, DashMetric.usersTotal.rawValue)) {
                    ForEach(DashMetric.allCases) { m in Text(m.label).tag(m.rawValue) }
                }
            }
        case .dailyChart:
            Section("Gegevens") {
                Picker("Gegevens", selection: value(\.series, "new_users")) {
                    Text("Nieuwe gebruikers").tag("new_users")
                    Text("Inlogs").tag("signins")
                    Text("Accounts met app-activiteit").tag("active_users")
                }
                Picker("Periode", selection: value(\.days, 30)) {
                    ForEach(DashOptions.daysValues, id: \.self) { d in Text("Laatste \(d) dagen").tag(d) }
                }
                Picker("Weergave", selection: value(\.display, "chart")) {
                    Text("Grafiek").tag("chart")
                    Text("Getal").tag("number")
                }
                .pickerStyle(.segmented)
            }
        case .platforms:
            Section("Gegevens") {
                Picker("Periode", selection: value(\.source, "30d")) {
                    Text("Laatste 30 dagen").tag("30d")
                    Text("Nu actief (15 min)").tag("live")
                }
            }
            platformSection
        case .versions:
            platformSection
        case .plans:
            Section {
                ForEach(DashOptions.planValues, id: \.self) { k in
                    Toggle(DashText.planNames[k] ?? k, isOn: member(\.plans, k, all: DashOptions.planValues, minOne: true))
                }
            } header: {
                Text("Abonnementen")
            } footer: {
                Text("Minstens één.")
            }
        case .support:
            Section {
                ForEach(DashOptions.statusValues, id: \.self) { k in
                    Toggle(Labels.ticketStatus(k), isOn: member(\.statuses, k, all: DashOptions.statusValues, minOne: true))
                }
            } header: {
                Text("Statussen")
            } footer: {
                Text("Minstens één. Een tik op de widget opent Support met dit filter.")
            }
            Section("Weergave") {
                Picker("Weergave", selection: value(\.display, "number")) {
                    Text("Getal").tag("number")
                    Text("Lijst per status").tag("list")
                }
                .pickerStyle(.segmented)
            }
        case .status:
            Section("Gegevens") {
                Toggle("Storingen tonen", isOn: value(\.showIncidents, true))
                Toggle("Meldingen tonen (lopend en gepland)", isOn: value(\.showNotices, true))
            }
        case .announcements:
            Section("Gegevens") {
                Picker("Aantal", selection: value(\.count, 3)) {
                    ForEach(DashOptions.countValues, id: \.self) { n in Text("\(n) meldingen").tag(n) }
                }
            }
        case .pushSubscribers:
            Section {
                ForEach(DashOptions.pushPlatformValues, id: \.self) { k in
                    Toggle(isOn: member(\.pushPlatforms, k, all: DashOptions.pushPlatformValues, minOne: true)) {
                        Label(PushPlatformOption.name(k), systemImage: Labels.platformIcon(k == "ipados" ? "ipad" : k))
                    }
                }
            } header: {
                Text("Platforms")
            } footer: {
                Text("Minstens één. Accounts tellen altijd alle platforms.")
            }
            Section("Gegevens") {
                Toggle("Nieuw in de laatste 7 dagen tonen", isOn: value(\.showNew, true))
            }
        case .newsletter:
            Section("Gegevens") {
                Toggle("Nederlands en Engels apart tonen", isOn: value(\.showLangs, true))
            }
        }
    }

    private var platformSection: some View {
        let current = draft.options.platformList
        var seen = Set<String>()
        let all = (knownPlatforms + current).filter { seen.insert($0).inserted }
        return Section {
            if all.isEmpty {
                Text("Nog geen platforms bekend.").foregroundStyle(Color.textDim)
            }
            ForEach(all, id: \.self) { p in
                Toggle(isOn: member(\.platforms, p, all: all, minOne: false)) {
                    Label(Labels.platform(p), systemImage: Labels.platformIcon(p))
                }
            }
        } header: {
            Text("Platforms")
        } footer: {
            Text("Niets aangezet = alle platforms.")
        }
    }

    private func value<T>(_ key: WritableKeyPath<DashOptions, T?>, _ def: T) -> Binding<T> {
        Binding(get: { draft.options[keyPath: key] ?? def }, set: { draft.options[keyPath: key] = $0 })
    }

    /// Lid van een lijst-optie; `minOne` laat de laatste niet uitzetten.
    private func member(_ key: WritableKeyPath<DashOptions, [String]?>, _ item: String, all: [String], minOne: Bool) -> Binding<Bool> {
        Binding(
            get: { (draft.options[keyPath: key] ?? []).contains(item) },
            set: { on in
                var cur = draft.options[keyPath: key] ?? []
                if on {
                    if !cur.contains(item) { cur.append(item) }
                } else {
                    if minOne && cur.count <= 1 { return }
                    cur.removeAll { $0 == item }
                }
                draft.options[keyPath: key] = all.filter { cur.contains($0) }
            }
        )
    }
}

/// Widgets beheren: volgorde (slepen aan de grepen), verbergen, verborgen widgets terugzetten of verwijderen,
/// en nieuwe widgets toevoegen uit de galerij.
struct DashManageView: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var layout: DashLayout
    let titleFor: (DashWidget) -> String
    let changed: () -> Void

    private var hidden: [DashWidget] { layout.widgets.filter(\.hidden) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(layout.visible) { w in
                        HStack(spacing: 12) {
                            row(w)
                            Button {
                                setHidden(w.id, true)
                            } label: {
                                Image(systemName: "eye.slash").frame(width: 32, height: 32)
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("\(titleFor(w)) verbergen")
                        }
                    }
                    .onMove(perform: moveVisible)
                } header: {
                    Text("Op het overzicht")
                } footer: {
                    Text("Sleep aan de grepen om de volgorde te wijzigen.")
                }
                if !hidden.isEmpty {
                    Section("Verborgen") {
                        ForEach(hidden) { w in
                            HStack(spacing: 12) {
                                row(w)
                                Button("Tonen") { setHidden(w.id, false) }
                                    .buttonStyle(.borderless)
                                    .accessibilityLabel("\(titleFor(w)) tonen")
                            }
                        }
                        .onDelete { offsets in
                            let ids = Set(offsets.map { hidden[$0].id })
                            layout.widgets.removeAll { ids.contains($0.id) }
                            if layout.widgets.isEmpty { layout = .standard }
                        }
                    }
                }
                Section {
                    ForEach(DashWidgetType.allCases) { t in
                        HStack(spacing: 12) {
                            Image(systemName: t.icon).frame(width: 24).foregroundStyle(Color.bingrRed)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(t.name).font(.subheadline.weight(.semibold))
                                Text(t.summary).font(.caption).foregroundStyle(Color.textDim)
                            }
                            Spacer(minLength: 0)
                            Button("Toevoegen") { add(t) }
                                .buttonStyle(.borderless)
                                .disabled(layout.widgets.count >= DashLayout.maxWidgets)
                                .accessibilityLabel("\(t.name) toevoegen")
                        }
                    }
                } header: {
                    Text("Galerij")
                } footer: {
                    if layout.widgets.count >= DashLayout.maxWidgets {
                        Text("Maximaal \(DashLayout.maxWidgets) widgets; verwijder eerst een verborgen widget.")
                    }
                }
            }
            .environment(\.editMode, .constant(.active))
            .navigationTitle("Widgets")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Klaar") { dismiss() }.bold() }
            }
        }
    }

    private func row(_ w: DashWidget) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(titleFor(w)).font(.subheadline.weight(.semibold)).lineLimit(1)
            Text("\(w.type.name) · \(w.size.name.lowercased()) \(w.size.dims)").font(.caption).foregroundStyle(Color.textDim)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func moveVisible(from source: IndexSet, to destination: Int) {
        var visible = layout.visible
        visible.move(fromOffsets: source, toOffset: destination)
        layout.widgets = visible + layout.widgets.filter(\.hidden)
    }

    private func setHidden(_ id: String, _ value: Bool) {
        guard let i = layout.widgets.firstIndex(where: { $0.id == id }) else { return }
        layout.widgets[i].hidden = value
        if !value { changed() }
    }

    private func add(_ type: DashWidgetType) {
        guard layout.widgets.count < DashLayout.maxWidgets else { return }
        let id = DashLayout.newID(for: type, seen: Set(layout.widgets.map(\.id)))
        layout.widgets.append(DashWidget(id: id, type: type))
        changed()
    }
}
