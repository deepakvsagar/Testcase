import SwiftUI
import WebKit

/// Owns the web view that shows the StoryVerse site, plus the bridge that lets
/// the page use native features.
@MainActor
final class WebViewStore: NSObject, ObservableObject {
    enum LoadState: Equatable { case loading, loaded, failed(String) }

    @Published private(set) var state: LoadState = .loading
    @Published var showAccount = false

    let webView: WKWebView
    private let session: SessionStore
    private let dictation = Dictation()
    private let appleSignIn = AppleSignIn()
    private var hasLoadedOnce = false

    init(session: SessionStore) {
        self.session = session
        let configuration = WKWebViewConfiguration()
        configuration.limitsNavigationsToAppBoundDomains = true
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = "StoryVerseApp/\(AppConfig.appVersion.split(separator: " ").first ?? "1")"
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()

        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "storyverse")
        installBridge()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = UIColor(named: "LaunchBackground")
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        let refresh = UIRefreshControl()
        refresh.tintColor = .white
        refresh.addTarget(self, action: #selector(pullToRefresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh
    }

    func loadStart() {
        guard AppConfig.isConfigured else {
            state = .failed("This build isn’t connected to a StoryVerse site yet. Set STORYVERSE_SITE_HOST in project.yml.")
            return
        }
        state = .loading
        webView.load(URLRequest(url: AppConfig.startURL))
    }

    func retry() {
        if hasLoadedOnce, webView.url != nil { state = .loading; webView.reload() } else { loadStart() }
    }

    /// Re-injects the bridge so pages loaded later carry the current session.
    func sessionDidChange() {
        installBridge()
        let token = session.token.map { "'\($0)'" } ?? "null"
        webView.evaluateJavaScript("window.storyverseNative && window.storyverseNative._setSession(\(token));")
    }

    /// Clears drafts, caches, and cookies kept by the web view on this device.
    func clearWebsiteData() async {
        let store = WKWebsiteDataStore.default()
        await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
    }

    private func installBridge() {
        let controller = webView.configuration.userContentController
        controller.removeAllUserScripts()
        controller.addUserScript(WKUserScript(source: BridgeScript.source(sessionToken: session.token), injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
    }

    @objc private func pullToRefresh(_ control: UIRefreshControl) {
        webView.reload()
        control.endRefreshing()
    }

    // MARK: Native actions requested by the page

    func signInWithApple() async throws {
        let credential = try await appleSignIn.signIn()
        try await session.completeAppleSignIn(identityToken: credential.identityToken, rawNonce: credential.rawNonce)
        sessionDidChange()
        Haptics.play("success")
    }

    private func handle(_ message: BridgeMessage) async throws -> Any? {
        switch message.action {
        case .signIn:
            try await signInWithApple()
            return ["signedIn": true]
        case .signOut:
            session.signOut()
            sessionDidChange()
            return ["signedIn": false]
        case .openAccount:
            showAccount = true
            return nil
        case .dictate:
            return ["transcript": try await dictation.listen()]
        case .stopDictation:
            dictation.stop()
            return nil
        case .shareFile:
            guard let base64 = message.payload["base64"], let name = message.payload["fileName"] else { throw FileSharing.Failure.invalid }
            return ["completed": try await FileSharing.share(base64: base64, fileName: name)]
        case .haptic:
            Haptics.play(message.payload["style"] ?? "light")
            return nil
        case .openExternal:
            guard let url = message.payload["url"].flatMap(URL.init(string:)),
                  NavigationPolicy.decide(url: url, siteHost: AppConfig.siteHost) == .openExternally else { return nil }
            _ = await UIApplication.shared.open(url)
            return nil
        }
    }
}

extension WebViewStore: WKScriptMessageHandlerWithReply {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        // Only StoryVerse's own pages may use the bridge.
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == AppConfig.siteHost,
              let request = BridgeMessage(body: message.body) else {
            replyHandler(nil, "Unsupported request.")
            return
        }
        Task { @MainActor in
            do { replyHandler(try await self.handle(request), nil) }
            catch { replyHandler(nil, error.localizedDescription) }
        }
    }
}

extension WebViewStore: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        switch NavigationPolicy.decide(url: navigationAction.request.url, siteHost: AppConfig.siteHost, isMainFrame: mainFrame) {
        case .allow:
            return .allow
        case .openExternally:
            if let url = navigationAction.request.url { _ = await UIApplication.shared.open(url) }
            return .cancel
        case .nativeSignIn:
            showAccount = true
            return .cancel
        case .cancel:
            return .cancel
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        hasLoadedOnce = true
        state = .loaded
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loadFailed(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loadFailed(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    private func loadFailed(_ error: Error) {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        // A page that loaded before stays usable (the site's service worker serves drafts offline).
        if hasLoadedOnce && webView.url != nil && nsError.code != NSURLErrorNotConnectedToInternet { return }
        state = .failed(nsError.code == NSURLErrorNotConnectedToInternet
            ? "You’re offline. Connect to the internet to open StoryVerse."
            : "StoryVerse couldn’t load. Check your connection and try again.")
    }
}

extension WebViewStore: WKUIDelegate {
    // Without these, alert() does nothing and confirm() always returns false in a web view.
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async {
        _ = await present(message: message, actions: [("OK", .default, ())])
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async -> Bool {
        await present(message: message, actions: [("Cancel", .cancel, false), ("OK", .default, true)]) ?? false
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        // target="_blank" links (YouTube, Instagram, pricing) open outside the app.
        if let url = navigationAction.request.url, NavigationPolicy.decide(url: url, siteHost: AppConfig.siteHost) == .openExternally {
            UIApplication.shared.open(url)
        }
        return nil
    }

    private func present<T>(message: String, actions: [(String, UIAlertAction.Style, T)]) async -> T? {
        guard let presenter = UIApplication.shared.topViewController else { return nil }
        return await withCheckedContinuation { continuation in
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            for (title, style, value) in actions {
                alert.addAction(UIAlertAction(title: title, style: style) { _ in continuation.resume(returning: value) })
            }
            presenter.present(alert, animated: true)
        }
    }
}
