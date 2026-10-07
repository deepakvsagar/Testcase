import SwiftUI
import WebKit

struct ContentView: View {
    @StateObject private var store: WebViewStore
    @EnvironmentObject private var session: SessionStore

    init(session: SessionStore) {
        _store = StateObject(wrappedValue: WebViewStore(session: session))
    }

    var body: some View {
        ZStack {
            Color("LaunchBackground").ignoresSafeArea()
            // The page starts below the status bar so scrolled content never runs
            // under the clock or Dynamic Island; it still extends under the home indicator.
            StoryWebView(webView: store.webView)
                .ignoresSafeArea(.container, edges: .bottom)
                .opacity(store.state == .loaded ? 1 : 0)
            switch store.state {
            case .loading:
                ProgressView().tint(.white).controlSize(.large)
            case .failed(let message):
                OfflineView(message: message, retry: store.retry)
            case .loaded:
                EmptyView()
            }
        }
        .onAppear {
            if store.webView.url == nil { store.loadStart() }
            #if DEBUG
            // Lets CI capture the Account screen: launch with -StoryVerseShowAccount.
            if ProcessInfo.processInfo.arguments.contains("-StoryVerseShowAccount") { store.showAccount = true }
            #endif
        }
        .sheet(isPresented: $store.showAccount) {
            AccountView(store: store)
                .environmentObject(session)
        }
    }
}

struct StoryWebView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

struct OfflineView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Image("BrandMark")
                .resizable()
                .scaledToFit()
                .frame(width: 96, height: 96)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .accessibilityHidden(true)
            Text("StoryVerse")
                .font(.title.bold())
            Text(message)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Try again", action: retry)
                .buttonStyle(.borderedProminent)
                .tint(Color("AccentColor"))
        }
        .padding(32)
        .frame(maxWidth: 420)
    }
}
