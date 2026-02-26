import Foundation

/// Calls the Railway backend to resolve a URL into metadata + audio stream URL.
actor MetadataService {
    static let shared = MetadataService()

    // Override in development: set AUDIO_QUEUE_BACKEND_URL env var or change this default.
    private let baseURL: String = {
        ProcessInfo.processInfo.environment["AUDIO_QUEUE_BACKEND_URL"]
            ?? "https://audio-queue-production.up.railway.app"
    }()

    struct ResolvedItem: Decodable {
        let sourceType: String
        let title: String
        let publisher: String?
        let audioURL: String?
        let durationSeconds: Int?
        let thumbnailURL: String?
        let originalURL: String
    }

    /// Resolve a single URL. Updates the QueueItem's fields in place.
    func resolve(url: String) async throws -> ResolvedItem {
        guard let endpoint = URL(string: "\(baseURL)/api/resolve") else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 35

        let body = ["url": url]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }

        return try JSONDecoder().decode(ResolvedItem.self, from: data)
    }

    /// Resolve a batch of URLs.
    func resolveBatch(urls: [String]) async throws -> [ResolvedItem] {
        guard let endpoint = URL(string: "\(baseURL)/api/resolve/batch") else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 60

        let body = ["urls": urls]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }

        return try JSONDecoder().decode([ResolvedItem].self, from: data)
    }
}
