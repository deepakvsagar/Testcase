import AuthenticationServices
import CryptoKit
import UIKit

/// Runs the Sign in with Apple sheet and returns the identity token plus the raw
/// nonce whose SHA-256 Apple embedded in it (the Worker checks both).
@MainActor
final class AppleSignIn: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    struct Credential {
        let identityToken: String
        let rawNonce: String
    }

    enum Failure: LocalizedError {
        case cancelled
        case missingToken
        var errorDescription: String? {
            switch self {
            case .cancelled: return "Sign-in was cancelled."
            case .missingToken: return "Apple didn’t return a sign-in token. Please try again."
            }
        }
    }

    private var continuation: CheckedContinuation<Credential, Error>?
    private var rawNonce = ""

    func signIn() async throws -> Credential {
        rawNonce = Self.makeNonce()
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [] // StoryVerse needs no name or email.
        request.nonce = Self.sha256(rawNonce)
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            controller.performRequests()
        }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let data = credential.identityToken,
              let token = String(data: data, encoding: .utf8) else {
            finish(.failure(Failure.missingToken))
            return
        }
        finish(.success(Credential(identityToken: token, rawNonce: rawNonce)))
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let cancelled = (error as? ASAuthorizationError)?.code == .canceled
        finish(.failure(cancelled ? Failure.cancelled : error))
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        UIApplication.shared.activeKeyWindow ?? ASPresentationAnchor()
    }

    private func finish(_ result: Result<Credential, Error>) {
        continuation?.resume(with: result)
        continuation = nil
    }

    static func makeNonce(length: Int = 32) -> String {
        let characters = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var generator = SystemRandomNumberGenerator()
        return String((0..<length).map { _ in characters.randomElement(using: &generator)! })
    }

    static func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

extension UIApplication {
    /// The foreground window (UIApplication.keyWindow is deprecated in scene-based apps).
    var activeKeyWindow: UIWindow? {
        connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first(where: \.isKeyWindow)
    }

    var topViewController: UIViewController? {
        var top = activeKeyWindow?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}
