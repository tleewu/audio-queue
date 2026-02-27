import SwiftUI

struct ContentView: View {
    @StateObject private var queueVM = QueueViewModel()
    @StateObject private var playerVM = PlayerViewModel()

    var body: some View {
        NavigationStack {
            QueueListView(queueVM: queueVM, playerVM: playerVM)
        }
        .toolbar(.hidden, for: .navigationBar)
        .task {
            await queueVM.loadQueue()
            await queueVM.drainPendingURLs()
        }
        .onReceive(
            NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)
        ) { _ in
            Task {
                await queueVM.loadQueue()
                await queueVM.drainPendingURLs()
            }
        }
    }
}
