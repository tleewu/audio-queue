import SwiftUI
import WebKit

struct YouTubeAuthView: View {
    @Environment(\.dismiss) private var dismiss
    var onComplete: () -> Void

    var body: some View {
        NavigationStack {
            YouTubeWebView { cookieString in
                YouTubeCookieService.shared.saveCookies(cookieString)
                onComplete()
                dismiss()
            }
            .navigationTitle("Sign in to YouTube")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}

// MARK: - WKWebView wrapper

private struct YouTubeWebView: UIViewRepresentable {
    let onCookiesExtracted: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onCookiesExtracted: onCookiesExtracted)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        context.coordinator.webView = webView

        // Use mobile Safari UA — Google blocks sign-in from detected embedded web views
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

        let loginURL = URL(string: "https://accounts.google.com/ServiceLogin?continue=https://m.youtube.com/")!
        webView.load(URLRequest(url: loginURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    // MARK: - Coordinator

    final class Coordinator: NSObject, WKNavigationDelegate {
        weak var webView: WKWebView?
        let onCookiesExtracted: (String) -> Void
        private var extracted = false

        init(onCookiesExtracted: @escaping (String) -> Void) {
            self.onCookiesExtracted = onCookiesExtracted
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard !extracted,
                  let host = webView.url?.host,
                  host.contains("youtube.com") else { return }

            webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
                guard let self, !self.extracted else { return }

                let authCookieNames: Set<String> = ["SID", "HSID", "SSID"]
                let hasAuth = cookies.contains { authCookieNames.contains($0.name) }
                guard hasAuth else { return }

                self.extracted = true
                let netscape = Self.toNetscapeFormat(cookies)
                DispatchQueue.main.async {
                    self.onCookiesExtracted(netscape)
                }
            }
        }

        /// Convert HTTPCookies to Netscape cookie file format (what yt-dlp expects)
        static func toNetscapeFormat(_ cookies: [HTTPCookie]) -> String {
            let header = "# Netscape HTTP Cookie File\n"
            let lines = cookies.map { cookie -> String in
                let domain = cookie.domain.hasPrefix(".") ? cookie.domain : ".\(cookie.domain)"
                let flag = domain.hasPrefix(".") ? "TRUE" : "FALSE"
                let path = cookie.path
                let secure = cookie.isSecure ? "TRUE" : "FALSE"
                let expiry: String
                if let date = cookie.expiresDate {
                    expiry = String(Int(date.timeIntervalSince1970))
                } else {
                    expiry = "0"
                }
                return "\(domain)\t\(flag)\t\(path)\t\(secure)\t\(expiry)\t\(cookie.name)\t\(cookie.value)"
            }
            return header + lines.joined(separator: "\n") + "\n"
        }
    }
}
