import SwiftUI

/// The one screen: header, the queue, and the player bar.
struct ContentView: View {
    @StateObject private var queueVM = QueueViewModel()
    @ObservedObject private var engine = AudioEngine.shared
    @ObservedObject private var authService = AuthService.shared

    @State private var isReordering = false
    @State private var showAddURL = false
    @State private var showProfile = false
    @State private var showPlayer = false
    @State private var webItem: QueueItem?

    var body: some View {
        VStack(spacing: 0) {
            header
            list
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .safeAreaInset(edge: .bottom) {
            if engine.currentItem != nil {
                PlayerBar { showPlayer = true }
                    .transition(.move(edge: .bottom))
            }
        }
        .animation(.easeInOut(duration: 0.2), value: engine.currentItem?.id)
        .sheet(isPresented: $showAddURL) {
            AddURLView { urlString in
                Task { await queueVM.add(urlString) }
            }
        }
        .sheet(isPresented: $showProfile) {
            ProfileView(authService: authService, queueVM: queueVM)
        }
        .sheet(item: $webItem) { item in
            if let url = item.webURL {
                WebView(url: url)
                    .ignoresSafeArea()
            }
        }
        .fullScreenCover(isPresented: $showPlayer) {
            PlayerView()
        }
        .task {
            await authService.start()
            await refresh()
        }
        .onReceive(
            NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)
        ) { _ in
            Task { await refresh() }
        }
    }

    private func refresh() async {
        await queueVM.load()
        await queueVM.drainSharedURLs()
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 12) {
            if isReordering {
                Text("Reorder")
                    .font(.headline)
                Spacer()
                Button("Done") {
                    withAnimation { isReordering = false }
                }
                .fontWeight(.semibold)
            } else {
                Button {
                    showProfile = true
                } label: {
                    Image(systemName: "person.crop.circle")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Button {
                    showAddURL = true
                } label: {
                    Image(systemName: "plus")
                        .font(.headline)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 4)
    }

    // MARK: - List

    private var list: some View {
        List {
            if queueVM.addingCount > 0 {
                Text(queueVM.addingCount == 1 ? "Adding link…" : "Adding \(queueVM.addingCount) links…")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            if queueVM.queue.isEmpty {
                emptyState
                    .listRowSeparator(.hidden)
            } else {
                ForEach(queueVM.queue) { item in
                    QueueRowView(
                        item: item,
                        isCurrent: engine.currentItem?.id == item.id,
                        isPlaying: engine.isPlaying,
                        secondsRemaining: secondsRemaining(for: item),
                        onPlayPause: { playPause(item) }
                    )
                    .contentShape(Rectangle())
                    .onTapGesture { open(item) }
                    .simultaneousGesture(
                        LongPressGesture(minimumDuration: 0.5).onEnded { _ in
                            withAnimation { isReordering = true }
                        }
                    )
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            queueVM.delete(item)
                        } label: {
                            Text("Delete")
                        }

                        Button {
                            queueVM.setListened(item, true)
                        } label: {
                            Text("Archive")
                        }
                        .tint(.green)
                    }
                }
                .onMove { source, destination in
                    queueVM.move(from: source, to: destination)
                }
            }
        }
        .listStyle(.plain)
        .environment(\.editMode, .constant(isReordering ? .active : .inactive))
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Your queue is empty")
                .font(.title3)
                .fontWeight(.medium)
            Text("Share a link to cue. Podcast episodes play here; everything else opens in a web view.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 24)
    }

    // MARK: - Actions

    /// Podcast episodes play; everything else opens in a web view.
    private func open(_ item: QueueItem) {
        if item.isPodcast {
            playPause(item)
        } else {
            webItem = item
        }
    }

    private func playPause(_ item: QueueItem) {
        guard item.isPodcast else { return }
        if engine.currentItem?.id == item.id {
            engine.togglePlayPause()
        } else {
            engine.play(item, upNext: itemsAfter(item))
        }
    }

    /// The playable items that follow `item` in the queue.
    private func itemsAfter(_ item: QueueItem) -> [QueueItem] {
        guard let index = queueVM.queue.firstIndex(where: { $0.id == item.id }) else { return [] }
        return queueVM.queue.dropFirst(index + 1).filter(\.isPodcast)
    }

    private func secondsRemaining(for item: QueueItem) -> Double? {
        guard let total = item.durationSeconds, total > 0 else { return nil }
        let elapsed = engine.currentItem?.id == item.id
            ? engine.currentTime
            : (engine.savedPosition(for: item.id) ?? 0)
        guard elapsed > 0 else { return nil }
        return max(0, Double(total) - elapsed)
    }
}
