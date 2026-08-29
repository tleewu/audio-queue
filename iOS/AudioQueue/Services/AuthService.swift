import AuthenticationServices
import Foundation

/// Who the queue belongs to. Anonymous until the user signs in to sync.
struct AccountInfo: Decodable, Equatable {
    let id: String
    let email: String?
    let isSignedIn: Bool
}

/// Sessions start anonymously from a device id kept in the keychain. Signing in
/// with Apple upgrades that same account, so nothing saved before is lost.
@MainActor
final class AuthService: ObservableObject {
    static let shared = AuthService()

    @Published private(set) var account: AccountInfo?

    var isSignedIn: Bool { account?.isSignedIn ?? false }

    private init() {}

    /// Makes sure there is a usable session. Safe to call repeatedly.
    func start() async {
        guard account == nil else { return }

        if KeychainService.loadToken() != nil {
            do {
                account = try await APIClient.shared.fetchAccount()
                return
            } catch APIError.unauthorized {
                KeychainService.deleteToken() // expired or deleted account
            } catch {
                return // offline — keep the token and try again later
            }
        }

        do {
            let session = try await APIClient.shared.signInWithDevice(deviceId: KeychainService.deviceId())
            KeychainService.saveToken(session.token)
            account = session.user
        } catch {
            print("device sign-in failed:", error)
        }
    }

    // MARK: - Sign in with Apple

    func signInWithApple(credential: ASAuthorizationAppleIDCredential) async throws {
        guard
            let tokenData = credential.identityToken,
            let identityToken = String(data: tokenData, encoding: .utf8)
        else { throw URLError(.badServerResponse) }

        let session = try await APIClient.shared.signInWithApple(identityToken: identityToken)
        KeychainService.saveToken(session.token)
        account = session.user
    }

    /// Drops the synced session and falls back to this device's own account.
    func signOut() {
        KeychainService.deleteToken()
        account = nil
        Task { await start() }
    }

    /// Permanently deletes the account server-side, then starts a fresh one.
    func deleteAccount() async throws {
        try await APIClient.shared.deleteAccount()
        signOut()
    }
}
