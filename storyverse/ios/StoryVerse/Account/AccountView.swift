import SwiftUI
import WebKit

struct AccountView: View {
    @ObservedObject var store: WebViewStore
    @EnvironmentObject private var session: SessionStore
    @Environment(\.dismiss) private var dismiss
    @State private var working = false
    @State private var errorMessage: String?
    @State private var confirmDelete = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if session.isSignedIn {
                        Label("Signed in with Apple", systemImage: "checkmark.seal.fill")
                            .foregroundStyle(.green)
                        Button("Sign out") {
                            session.signOut()
                            store.sessionDidChange()
                        }
                    } else {
                        Text("Sign in to generate stories, scene plans, voiceovers, and videos. StoryVerse doesn’t ask for your name or email.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                        Button {
                            Task { await signIn() }
                        } label: {
                            Label(working ? "Signing in…" : "Sign in with Apple", systemImage: "apple.logo")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.white)
                        .foregroundStyle(.black)
                        .disabled(working)
                        .accessibilityHint("Opens the Sign in with Apple sheet")
                    }
                    if let errorMessage {
                        Text(errorMessage).font(.footnote).foregroundStyle(.red)
                    }
                } header: {
                    Text("Account")
                }

                Section {
                    Link(destination: AppConfig.privacyURL) { Label("Privacy policy", systemImage: "hand.raised") }
                    Link(destination: AppConfig.supportURL) { Label("Help & support", systemImage: "questionmark.circle") }
                } header: {
                    Text("About")
                } footer: {
                    Text("StoryVerse \(AppConfig.appVersion)")
                }

                Section {
                    Button("Delete account and data", role: .destructive) { confirmDelete = true }
                } footer: {
                    Text("Signs you out and erases your drafts and settings from this device. StoryVerse keeps no account data on its servers. To also stop using your Apple ID with StoryVerse, go to Settings → your name → Sign in with Apple.")
                }
            }
            .navigationTitle("StoryVerse")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .confirmationDialog("Delete your StoryVerse account and all drafts on this device?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete account and data", role: .destructive) { Task { await deleteAccount() } }
            } message: {
                Text("This can’t be undone. Save any project files you want to keep first.")
            }
        }
    }

    private func signIn() async {
        working = true
        errorMessage = nil
        defer { working = false }
        do {
            try await store.signInWithApple()
            dismiss()
        } catch AppleSignIn.Failure.cancelled {
            // The person closed the sheet; nothing to report.
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteAccount() async {
        session.signOut()
        await store.clearWebsiteData()
        store.sessionDidChange()
        store.loadStart()
        dismiss()
    }
}
