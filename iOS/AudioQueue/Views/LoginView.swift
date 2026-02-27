import SwiftUI
import AuthenticationServices

struct LoginView: View {
    @ObservedObject var authService: AuthService
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "headphones")
                .font(.system(size: 72))
                .foregroundStyle(.primary)

            Text("Audio Queue")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("Sign in to sync your queue across devices.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)

            Spacer()

            if isLoading {
                ProgressView()
                    .scaleEffect(1.2)
                    .padding()
            } else {
                SignInWithAppleButton(.signIn) { request in
                    request.requestedScopes = [.fullName, .email]
                } onCompletion: { result in
                    handleResult(result)
                }
                .signInWithAppleButtonStyle(.black)
                .frame(height: 50)
                .padding(.horizontal, 40)
            }

            if let error = errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }

            Spacer().frame(height: 40)
        }
    }

    private func handleResult(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let auth):
            guard let credential = auth.credential as? ASAuthorizationAppleIDCredential else { return }
            isLoading = true
            errorMessage = nil
            Task {
                do {
                    try await authService.signInWithApple(credential: credential)
                } catch {
                    errorMessage = "Sign in failed. Please try again."
                }
                isLoading = false
            }
        case .failure(let error as ASAuthorizationError) where error.code == .canceled:
            break // user cancelled — no error shown
        case .failure:
            errorMessage = "Sign in failed. Please try again."
        }
    }
}
