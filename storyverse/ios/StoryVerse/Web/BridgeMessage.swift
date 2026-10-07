import Foundation

/// A request from the page: `storyverseNative.call(action, payload)`.
struct BridgeMessage: Equatable {
    enum Action: String {
        case signIn, signOut, openAccount, dictate, stopDictation, shareFile, haptic, openExternal
    }

    let action: Action
    let payload: [String: String]

    /// Accepts only known actions with string payload values.
    init?(body: Any) {
        guard let dictionary = body as? [String: Any],
              let name = dictionary["action"] as? String,
              let action = Action(rawValue: name) else { return nil }
        let raw = dictionary["payload"] as? [String: Any] ?? [:]
        self.action = action
        self.payload = raw.compactMapValues { $0 as? String }
    }
}
