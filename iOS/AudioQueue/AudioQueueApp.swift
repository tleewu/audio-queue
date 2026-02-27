import SwiftUI

@main
struct AudioQueueApp: App {
    @StateObject private var authService = AuthService.shared

    var body: some Scene {
        WindowGroup {
            if authService.isAuthenticated {
                ContentView()
                    .environmentObject(authService)
            } else {
                LoginView(authService: authService)
            }
        }
    }
}
