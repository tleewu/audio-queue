import Foundation

@MainActor
final class YouTubeCookieService: ObservableObject {
    static let shared = YouTubeCookieService()

    @Published var isSignedIn: Bool

    private init() {
        isSignedIn = KeychainService.loadYouTubeCookies() != nil
    }

    var cookies: String? {
        KeychainService.loadYouTubeCookies()
    }

    func saveCookies(_ cookieString: String) {
        KeychainService.saveYouTubeCookies(cookieString)
        isSignedIn = true
    }

    func signOut() {
        KeychainService.deleteYouTubeCookies()
        isSignedIn = false
    }
}
