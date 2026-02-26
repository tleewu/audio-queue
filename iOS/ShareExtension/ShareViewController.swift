import UIKit
import Social
import UniformTypeIdentifiers

/// Share Extension entry point.
/// Reads the shared URL (or plain text), appends it to the App Group
/// UserDefaults queue, then closes immediately. The main app drains the
/// queue on next foreground.
class ShareViewController: UIViewController {
    private let appGroupID = "group.com.yourname.audioqueue"
    private let pendingKey = "pendingURLs"

    override func viewDidLoad() {
        super.viewDidLoad()
        extractURL { [weak self] urlString in
            guard let self, let urlString else {
                self?.cancel()
                return
            }
            self.saveURL(urlString)
            self.complete()
        }
    }

    // MARK: - URL Extraction

    private func extractURL(completion: @escaping (String?) -> Void) {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let providers = item.attachments else {
            completion(nil)
            return
        }

        // 1. Try UTType.url first
        if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) {
            provider.loadItem(forTypeIdentifier: UTType.url.identifier) { item, _ in
                let urlString: String?
                if let url = item as? URL {
                    urlString = url.absoluteString
                } else if let str = item as? String, URL(string: str) != nil {
                    urlString = str
                } else {
                    urlString = nil
                }
                DispatchQueue.main.async { completion(urlString) }
            }
            return
        }

        // 2. Fallback: plain text (user shared a URL as text)
        if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) {
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { item, _ in
                let urlString: String?
                if let str = item as? String, URL(string: str.trimmingCharacters(in: .whitespacesAndNewlines)) != nil {
                    urlString = str.trimmingCharacters(in: .whitespacesAndNewlines)
                } else {
                    urlString = nil
                }
                DispatchQueue.main.async { completion(urlString) }
            }
            return
        }

        completion(nil)
    }

    // MARK: - App Group Bridge

    private func saveURL(_ urlString: String) {
        guard let defaults = UserDefaults(suiteName: appGroupID) else { return }
        var pending = defaults.stringArray(forKey: pendingKey) ?? []
        guard !pending.contains(urlString) else { return }
        pending.append(urlString)
        defaults.set(pending, forKey: pendingKey)
        defaults.synchronize()
    }

    // MARK: - Extension Lifecycle

    private func complete() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }

    private func cancel() {
        extensionContext?.cancelRequest(withError: URLError(.badURL))
    }
}
