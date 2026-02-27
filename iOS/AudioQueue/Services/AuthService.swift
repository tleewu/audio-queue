import Foundation
import AuthenticationServices

@MainActor
final class AuthService: ObservableObject {
    static let shared = AuthService()

    @Published var isAuthenticated: Bool

    private init() {
        isAuthenticated = KeychainService.loadToken() != nil
        checkCredentialState()
    }

    // MARK: - Sign In with Apple

    func signInWithApple(credential: ASAuthorizationAppleIDCredential) async throws {
        guard
            let tokenData = credential.identityToken,
            let identityToken = String(data: tokenData, encoding: .utf8)
        else { throw URLError(.badServerResponse) }

        let response = try await APIClient.shared.signInWithApple(identityToken: identityToken)
        KeychainService.saveToken(response.token)
        isAuthenticated = true
    }

    func signOut() {
        KeychainService.deleteToken()
        isAuthenticated = false
    }

    // MARK: - Credential state check

    private func checkCredentialState() {
        guard let userID = storedAppleUserID() else { return }
        let provider = ASAuthorizationAppleIDProvider()
        provider.getCredentialState(forUserID: userID) { [weak self] state, _ in
            if state == .revoked || state == .notFound {
                Task { @MainActor in self?.signOut() }
            }
        }
    }

    private func storedAppleUserID() -> String? {
        // We don't persist the Apple user ID separately; rely on JWT validity.
        // This is a best-effort revocation check — JWT expiry is the hard gate.
        return nil
    }
}
