import SwiftUI
import SwiftData

@main
struct AudioQueueApp: App {
    let container: ModelContainer

    init() {
        do {
            container = try ModelContainer(for: QueueItem.self)
        } catch {
            fatalError("Failed to create ModelContainer: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .modelContainer(container)
        }
    }
}
