import SwiftUI
import SwiftData

struct ContentView: View {
    @Environment(\.modelContext) private var context
    @StateObject private var queueVM = QueueViewModel()
    @StateObject private var playerVM = PlayerViewModel()

    var body: some View {
        NavigationStack {
            QueueListView(queueVM: queueVM, playerVM: playerVM)
        }
        .task {
            queueVM.refreshSortedQueue(context: context)
            await queueVM.drainPendingURLs(context: context)
        }
        .onReceive(
            NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)
        ) { _ in
            Task {
                await queueVM.drainPendingURLs(context: context)
            }
        }
    }
}
