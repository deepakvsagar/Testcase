import Foundation

/// A StoryVerse app session issued by the Worker after Sign in with Apple.
struct AppSession: Codable, Equatable {
    let token: String
    let expiresAt: Date

    var isValid: Bool { expiresAt > Date() && token.hasPrefix("sv1.") }
}

enum SessionError: LocalizedError {
    case notConfigured
    case server(String)
    case unreadableResponse

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "This build isn’t connected to a StoryVerse site yet."
        case .server(let message): return message
        case .unreadableResponse: return "StoryVerse couldn’t complete sign-in. Please try again."
        }
    }
}

@MainActor
final class SessionStore: ObservableObject {
    @Published private(set) var session: AppSession?
    private static let keychainAccount = "app-session"

    init() {
        if let stored = Keychain.read(Self.keychainAccount),
           let data = stored.data(using: .utf8),
           let session = try? Self.decoder.decode(AppSession.self, from: data),
           session.isValid {
            self.session = session
        }
    }

    var isSignedIn: Bool { session?.isValid == true }
    var token: String? { isSignedIn ? session?.token : nil }

    /// Exchanges an Apple identity token for a StoryVerse session.
    func completeAppleSignIn(identityToken: String, rawNonce: String) async throws {
        guard AppConfig.isConfigured else { throw SessionError.notConfigured }
        var request = URLRequest(url: URL(string: "/api/auth/apple", relativeTo: AppConfig.siteOrigin)!.absoluteURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // The Worker only accepts sign-in from its own origin.
        request.setValue(AppConfig.siteOrigin.absoluteString, forHTTPHeaderField: "Origin")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["identityToken": identityToken, "nonce": rawNonce])
        let (data, response) = try await URLSession.shared.data(for: request)
        let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw SessionError.server(payload?["error"] as? String ?? "Sign-in failed. Please try again.")
        }
        guard let token = payload?["session"] as? String, let expiresAt = payload?["expiresAt"] as? Double else {
            throw SessionError.unreadableResponse
        }
        let session = AppSession(token: token, expiresAt: Date(timeIntervalSince1970: expiresAt / 1000))
        if let data = try? Self.encoder.encode(session), let text = String(data: data, encoding: .utf8) {
            Keychain.write(text, for: Self.keychainAccount)
        }
        self.session = session
    }

    func signOut() {
        Keychain.delete(Self.keychainAccount)
        session = nil
    }

    private static let encoder: JSONEncoder = { let e = JSONEncoder(); e.dateEncodingStrategy = .secondsSince1970; return e }()
    private static let decoder: JSONDecoder = { let d = JSONDecoder(); d.dateDecodingStrategy = .secondsSince1970; return d }()
}
