import Foundation

/// Where the app's content lives. The host comes from the STORYVERSE_SITE_HOST
/// build setting (project.yml), copied into Info.plist as StoryVerseSiteHost.
enum AppConfig {
    static let placeholderHost = "storyverse.example.com"

    static var siteHost: String {
        (Bundle.main.object(forInfoDictionaryKey: "StoryVerseSiteHost") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    /// True when the build points at a real deployment rather than the placeholder.
    static var isConfigured: Bool { isValidHost(siteHost) && siteHost != placeholderHost }

    static var siteOrigin: URL { URL(string: "https://\(siteHost)")! }
    static var startURL: URL { URL(string: "/create.html?source=ios", relativeTo: siteOrigin)!.absoluteURL }
    static var privacyURL: URL { URL(string: "/privacy.html", relativeTo: siteOrigin)!.absoluteURL }
    static var supportURL: URL { URL(string: "/support.html", relativeTo: siteOrigin)!.absoluteURL }

    static var appVersion: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return "\(version) (\(build))"
    }

    /// A bare host name such as "storyverse.example.com": no scheme, path, or port.
    static func isValidHost(_ host: String) -> Bool {
        guard !host.isEmpty, !host.contains("/"), !host.contains(":"), !host.contains("$") else { return false }
        return URL(string: "https://\(host)")?.host == host
    }
}
