import SwiftUI

@main
struct StoryVerseApp: App {
    @StateObject private var session = SessionStore()

    var body: some Scene {
        WindowGroup {
            ContentView(session: session)
                .environmentObject(session)
                .preferredColorScheme(.dark)
        }
    }
}
