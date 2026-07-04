import SwiftUI

struct SettingsView: View {
    @ObservedObject var authService: AuthService
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

                Section("Account") {
                    Button("Sign Out") {
                        authService.signOut()
                    }

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
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Settings")
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
                // signOut() flips isAuthenticated; the app returns to LoginView
            } catch {
                errorMessage = "Couldn't delete your account. Check your connection and try again."
            }
            isDeleting = false
        }
    }
}
