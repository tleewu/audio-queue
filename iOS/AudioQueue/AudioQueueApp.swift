import SwiftUI

@main
struct AudioQueueApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                // Monochrome throughout: no system-blue accent anywhere.
                .tint(.primary)
        }
    }
}
