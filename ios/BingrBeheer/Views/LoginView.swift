import SwiftUI

/// Inloggen met de beheer-gebruikersnaam en het wachtwoord (actie `login`; 5 fouten per IP = 15 min geblokkeerd).
struct LoginView: View {
    @Environment(Session.self) private var session
    @State private var user = ""
    @State private var password = ""
    @State private var error = ""
    @State private var busy = false
    @FocusState private var focus: Field?

    private enum Field { case user, password }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                BingrLogo(size: 30)
                    .padding(.bottom, 8)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Gebruikersnaam").font(.subheadline.weight(.semibold)).foregroundStyle(Color.textSecondary)
                    TextField("", text: $user)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .user)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                        .fieldStyle()
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("Wachtwoord").font(.subheadline.weight(.semibold)).foregroundStyle(Color.textSecondary)
                    SecureField("", text: $password)
                        .textContentType(.password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit { Task { await login() } }
                        .fieldStyle()
                }
                if !error.isEmpty {
                    Text(error).font(.subheadline).foregroundStyle(Color.warn)
                }
                Button {
                    Task { await login() }
                } label: {
                    HStack {
                        if busy { ProgressView().tint(.white) }
                        Text("Inloggen")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bingr)
                .disabled(busy)
            }
            .padding(28)
            .background(RoundedRectangle(cornerRadius: 16).fill(Color.surface1))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.white.opacity(0.08)))
            .frame(maxWidth: 420)
            .padding(20)
            .padding(.top, 60)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .onAppear {
            if let m = session.loginMessage { error = m }
            focus = .user
        }
    }

    private func login() async {
        let u = user.trimmingCharacters(in: .whitespaces)
        guard !u.isEmpty, !password.isEmpty else {
            error = "Vul gebruikersnaam en wachtwoord in."
            return
        }
        busy = true
        error = ""
        defer { busy = false }
        do {
            try await session.login(user: u, password: password)
            password = ""
        } catch let e as APIError {
            switch e.code {
            case "locked":
                let mins = Int((Double(e.body["retry_after"].int ?? 900) / 60).rounded(.up))
                error = "Te veel pogingen. Probeer het over \(mins) minuten opnieuw."
            default:
                error = APIError.text(e.code)
            }
        } catch {
            self.error = APIError.text("server_error")
        }
    }
}

extension View {
    /// Invoerveld in Bingr-stijl (zoals input in admin.css).
    func fieldStyle() -> some View {
        self.padding(.horizontal, 12)
            .padding(.vertical, 11)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.surface2))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Color.white.opacity(0.14)))
    }
}
