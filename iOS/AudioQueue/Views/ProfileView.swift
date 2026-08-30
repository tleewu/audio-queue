import AuthenticationServices
import SwiftUI

/// Account, archive, and the App Store legal pages.
struct ProfileView: View {
    @ObservedObject var authService: AuthService
    @ObservedObject var queueVM: QueueViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var showDeleteConfirmation = false
    @State private var isDeleting = false
    @State private var errorMessage: String?

    private var appVersion: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return "\(version) (\(build))"
    }

    var body: some View {
        NavigationStack {
            List {
                accountSection

                Section {
                    NavigationLink {
                        ArchiveView(queueVM: queueVM)
                    } label: {
                        HStack {
                            Text("Archive")
                            Spacer()
                            Text("\(queueVM.archive.count)")
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Section("About") {
                    link("Privacy Policy", path: "/privacy")
                    link("Terms of Use", path: "/terms")
                    link("Support", path: "/support")
                    HStack {
                        Text("Version")
                        Spacer()
                        Text(appVersion)
                            .foregroundStyle(.secondary)
                    }
                }

                Section {
                    Button(role: .destructive) {
                        showDeleteConfirmation = true
                    } label: {
                        if isDeleting {
                            HStack {
                                Text("Deleting…")
                                Spacer()
                                ProgressView()
                            }
                        } else {
                            Text("Delete Account")
                        }
                    }
                    .disabled(isDeleting)
                } footer: {
                    Text("Deletes your queue and everything stored for this account.")
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
            .confirmationDialog(
                "Delete your account?",
                isPresented: $showDeleteConfirmation,
                titleVisibility: .visible
            ) {
                Button("Delete Account and All Data", role: .destructive) {
                    deleteAccount()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This permanently deletes your account and your entire queue. This cannot be undone.")
            }
        }
    }

    // MARK: - Account

    @ViewBuilder
    private var accountSection: some View {
        if authService.isSignedIn {
            Section("Account") {
                HStack {
                    Text("Signed in")
                    Spacer()
                    Text(authService.account?.email ?? "Apple ID")
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Button("Sign Out") { authService.signOut() }
            }
        } else {
            Section {
                SignInWithAppleButton(.signIn) { request in
                    request.requestedScopes = [.fullName, .email]
                } onCompletion: { result in
                    handleSignIn(result)
                }
                .signInWithAppleButtonStyle(.black)
                .frame(height: 46)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            } header: {
                Text("Account")
            } footer: {
                Text("Your queue lives on this device. Sign in to sync it across your devices — everything you've saved comes with you.")
            }
        }
    }

    private func handleSignIn(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let auth):
            guard let credential = auth.credential as? ASAuthorizationAppleIDCredential else { return }
            errorMessage = nil
            Task {
                do {
                    try await authService.signInWithApple(credential: credential)
                    await queueVM.load()
                } catch {
                    errorMessage = "Sign in failed. Please try again."
                }
            }
        case .failure(let error as ASAuthorizationError) where error.code == .canceled:
            break // user cancelled
        case .failure:
            errorMessage = "Sign in failed. Please try again."
        }
    }

    // MARK: - Helpers

    private func link(_ title: String, path: String) -> some View {
        Group {
            if let url = URL(string: BackendConfig.baseURL + path) {
                Link(title, destination: url)
            } else {
                Text(title)
            }
        }
    }

    private func deleteAccount() {
        isDeleting = true
        errorMessage = nil
        Task {
            do {
                try await authService.deleteAccount()
                queueVM.items = []
                dismiss()
            } catch {
                errorMessage = "Couldn't delete your account. Check your connection and try again."
            }
            isDeleting = false
        }
    }
}

/// Everything already listened to. Reached from the profile.
struct ArchiveView: View {
    @ObservedObject var queueVM: QueueViewModel
    @ObservedObject private var engine = AudioEngine.shared

    @State private var webItem: QueueItem?

    var body: some View {
        List {
            if queueVM.archive.isEmpty {
                Text("Nothing archived yet.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .listRowSeparator(.hidden)
            } else {
                ForEach(queueVM.archive) { item in
                    QueueRowView(
                        item: item,
                        isCurrent: engine.currentItem?.id == item.id,
                        isPlaying: engine.isPlaying,
                        onPlayPause: { play(item) }
                    )
                    // Separators default to aligning with the text, which leaves
                    // them inset past the artwork. Run them the full width.
                    .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                    .contentShape(Rectangle())
                    .onTapGesture {
                        if item.isPodcast {
                            play(item)
                        } else {
                            webItem = item
                        }
                    }
                    // Unarchive leads so a full swipe restores rather than
                    // destroys; explicit tints keep both readable in dark mode.
                    .swipeActions(edge: .trailing) {
                        Button {
                            queueVM.setListened(item, false)
                        } label: {
                            Label("Unarchive", systemImage: "tray.and.arrow.up.fill")
                        }
                        .tint(.gray)

                        Button(role: .destructive) {
                            queueVM.delete(item)
                        } label: {
                            Label("Delete", systemImage: "trash.fill")
                        }
                        .tint(.red)
                    }
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle("Archive")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $webItem) { item in
            if let url = item.webURL {
                WebView(url: url).ignoresSafeArea()
            }
        }
    }

    private func play(_ item: QueueItem) {
        guard item.isPodcast else { return }
        if engine.currentItem?.id == item.id {
            engine.togglePlayPause()
        } else {
            engine.play(item)
        }
    }
}
