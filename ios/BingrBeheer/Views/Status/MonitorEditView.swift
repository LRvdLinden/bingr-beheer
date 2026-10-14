import SwiftUI

/// Monitor toevoegen of bewerken (`status` met op `monitor_save` / `monitor_delete`).
struct MonitorEditView: View {
    let monitor: Monitor?
    let intervals: [Int]
    let onSaved: () async -> Void

    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var nameNl = ""
    @State private var nameEn = ""
    @State private var group = "website"
    @State private var url = ""
    @State private var keyword = ""
    @State private var interval = 5
    @State private var isPublic = false
    @State private var enabled = true
    @State private var error = ""
    @State private var saving = false
    @State private var confirmDelete = false

    private var isNew: Bool { monitor == nil }
    private var isHTTP: Bool { monitor == nil || monitor?.kind == "http" }
    private var fixedGroup: Bool { monitor?.builtin == true }

    var body: some View {
        Form {
            if isNew {
                Section {
                    Text("Controleert een webadres: antwoord 2xx binnen 10 seconden, en optioneel een woord in de pagina.")
                        .font(.subheadline).foregroundStyle(Color.textSecondary)
                }
            }
            Section("Naam") {
                TextField("Naam (Nederlands)", text: $nameNl)
                TextField("Naam (Engels)", text: $nameEn)
            }
            if !fixedGroup {
                Section {
                    Picker("Groep", selection: $group) {
                        ForEach(Labels.groups, id: \.key) { g in Text(g.label).tag(g.key) }
                    }
                }
            }
            if isHTTP {
                Section {
                    TextField("https://", text: $url)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Trefwoord (optioneel)", text: $keyword)
                        .textInputAutocapitalization(.never)
                } header: {
                    Text("Adres")
                } footer: {
                    Text("Trefwoord: moet in de pagina staan.")
                }
            }
            Section {
                Picker("Interval", selection: $interval) {
                    ForEach(intervals, id: \.self) { n in Text(Fmt.interval(n)).tag(n) }
                }
                if monitor?.kind != "devices" {
                    Toggle("Tonen op de openbare statuspagina", isOn: $isPublic)
                }
                Toggle("Aan", isOn: $enabled)
            } footer: {
                if fixedGroup { Text("Standaardmonitor: uitzetten kan, verwijderen niet.") }
            }
            if !error.isEmpty {
                Section { Text(error).foregroundStyle(Color.warn) }
            }
            if let m = monitor, !m.builtin {
                Section {
                    Button("Verwijderen", role: .destructive) { confirmDelete = true }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .screenBackground()
        .navigationTitle(isNew ? "Monitor toevoegen" : "\(monitor?.nameNl ?? "") bewerken")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Annuleren") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button(isNew ? "Toevoegen" : "Opslaan") { Task { await save() } }.disabled(saving)
            }
        }
        .confirmationDialog("Monitor \"\(monitor?.nameNl ?? "")\" en alle metingen verwijderen?", isPresented: $confirmDelete,
                            titleVisibility: .visible) {
            Button("Verwijderen", role: .destructive) { Task { await delete() } }
        }
        .onAppear(perform: fill)
    }

    private func fill() {
        guard let m = monitor else { return }
        nameNl = m.nameNl
        nameEn = m.nameEn
        group = m.group.isEmpty ? "website" : m.group
        url = m.target ?? ""
        keyword = m.keyword ?? ""
        interval = intervals.contains(m.intervalMin) ? m.intervalMin : (intervals.first ?? 5)
        isPublic = m.isPublic
        enabled = m.enabled
    }

    private func save() async {
        let nl = nameNl.trimmingCharacters(in: .whitespaces)
        guard !nl.isEmpty else { error = APIError.text("name_missing"); return }
        var params: [String: Any?] = [
            "op": "monitor_save", "id": monitor?.id, "name_nl": String(nl.prefix(60)),
            "name_en": String(nameEn.trimmingCharacters(in: .whitespaces).prefix(60)),
            "grp": fixedGroup ? nil : group, "interval_min": interval,
            "public": monitor?.kind == "devices" ? false : isPublic, "enabled": enabled,
        ]
        if isHTTP {
            params["target"] = url.trimmingCharacters(in: .whitespaces)
            params["keyword"] = keyword.trimmingCharacters(in: .whitespaces)
        }
        saving = true
        defer { saving = false }
        do {
            try await session.call("status", params)
            session.show(isNew ? "Monitor toegevoegd." : "Monitor opgeslagen.")
            await onSaved()
            dismiss()
        } catch let e as APIError {
            if e.code != "auth" { error = e.errorDescription ?? "" }
        } catch {}
    }

    private func delete() async {
        guard let m = monitor else { return }
        do {
            try await session.call("status", ["op": "monitor_delete", "id": m.id])
            session.show("Monitor verwijderd.")
            await onSaved()
            dismiss()
        } catch let e as APIError {
            if e.code != "auth" { error = e.errorDescription ?? "" }
        } catch {}
    }
}
