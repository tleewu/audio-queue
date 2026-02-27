import Foundation

enum APIError: Error {
    case unauthorized
    case badResponse(Int)
    case noData
}

actor APIClient {
    static let shared = APIClient()

    private let baseURL: String = {
        ProcessInfo.processInfo.environment["AUDIO_QUEUE_BACKEND_URL"]
            ?? "https://audio-queue-production.up.railway.app"
    }()

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        d.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let str = try container.decode(String.self)
            if let date = iso.date(from: str) { return date }
            // fallback without fractional seconds
            let iso2 = ISO8601DateFormatter()
            if let date = iso2.date(from: str) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid date: \(str)")
        }
        return d
    }()

    // MARK: - Auth

    struct SignInResponse: Decodable {
        struct UserInfo: Decodable {
            let id: String
            let email: String?
        }
        let token: String
        let user: UserInfo
    }

    func signInWithApple(identityToken: String) async throws -> SignInResponse {
        var req = try buildRequest(path: "/api/auth/apple", method: "POST", auth: false)
        req.httpBody = try JSONEncoder().encode(["identityToken": identityToken])
        return try await perform(req)
    }

    // MARK: - Queue

    func fetchQueue() async throws -> [QueueItem] {
        let req = try buildRequest(path: "/api/queue", method: "GET")
        return try await perform(req)
    }

    func addToQueue(url: String) async throws -> QueueItem {
        var req = try buildRequest(path: "/api/queue", method: "POST")
        req.httpBody = try JSONEncoder().encode(["url": url])
        return try await perform(req)
    }

    func deleteFromQueue(id: String) async throws {
        let req = try buildRequest(path: "/api/queue/\(id)", method: "DELETE")
        let (_, response) = try await URLSession.shared.data(for: req)
        try checkStatus(response)
    }

    func markListened(id: String) async throws -> QueueItem {
        var req = try buildRequest(path: "/api/queue/\(id)", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(["isListened": true])
        return try await perform(req)
    }

    func markUnlistened(id: String) async throws -> QueueItem {
        var req = try buildRequest(path: "/api/queue/\(id)", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(["isListened": false])
        return try await perform(req)
    }

    func reorderQueue(order: [(id: String, position: Int)]) async throws {
        var req = try buildRequest(path: "/api/queue/reorder", method: "PATCH")
        let body = order.map { ["id": $0.id, "position": String($0.position)] }
        req.httpBody = try JSONEncoder().encode(["order": body])
        let (_, response) = try await URLSession.shared.data(for: req)
        try checkStatus(response)
    }

    // MARK: - Helpers

    private func buildRequest(path: String, method: String, auth: Bool = true) throws -> URLRequest {
        guard let url = URL(string: baseURL + path) else { throw URLError(.badURL) }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 35
        if auth {
            if let token = KeychainService.loadToken() {
                req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
        }
        return req
    }

    private func perform<T: Decodable>(_ req: URLRequest) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: req)
        try checkStatus(response)
        return try decoder.decode(T.self, from: data)
    }

    private func checkStatus(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw APIError.badResponse(http.statusCode) }
    }
}
