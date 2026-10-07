import Foundation

/// Decides where a link should open. Kept free of WebKit types so it can be unit tested.
enum NavigationDecision: Equatable {
    /// Load inside the app.
    case allow
    /// Open in Safari or the app that owns the link (YouTube, Instagram, mail…).
    case openExternally
    /// The web sign-in flow: replace it with Sign in with Apple.
    case nativeSignIn
    /// Ignore (for example, unsupported schemes).
    case cancel
}

enum NavigationPolicy {
    static func decide(url: URL?, siteHost: String, isMainFrame: Bool = true) -> NavigationDecision {
        guard let url, let scheme = url.scheme?.lowercased() else { return .cancel }
        switch scheme {
        case "about", "blob", "data":
            return .allow
        case "https":
            guard url.host?.lowercased() == siteHost.lowercased() else { return .openExternally }
            if url.path.hasPrefix("/signin") { return .nativeSignIn }
            return .allow
        case "mailto", "tel", "sms", "http":
            return isMainFrame ? .openExternally : .cancel
        default:
            return .cancel
        }
    }
}
