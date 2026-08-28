import SwiftUI

enum QueueTab: String, CaseIterable {
    case queue = "Queue"
    case archive = "Archive"
}

/// The one screen: header, the queue, and the player bar.
struct ContentView: View {
    @StateObject private var queueVM = QueueViewModel()
    @ObservedObject private var engine = AudioEngine.shared

    @State private var tab: QueueTab = .queue
    @State private var isReordering = false
    @State private var showAddURL = false
    @State private var showSettings = false
    @State private var showPlayer = false
    @State private var webItem: QueueItem?

    private var displayedItems: [QueueItem] {
        tab == .queue ? queueVM.queue : queueVM.archive
    }

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
        .sheet(isPresented: $showSettings) {
            SettingsView(authService: AuthService.shared)
        }
        .sheet(item: $webItem) { item in
            if let url = item.webURL {
                WebView(url: url)
                    .ignoresSafeArea()
            }
        }
        .fullScreenCover(isPresented: $showPlayer) {
            PlayerView(queueVM: queueVM)
        }
        .task { await refresh() }
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
                    showSettings = true
                } label: {
                    Image(systemName: "gearshape")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                }

                Spacer()
                tabToggleButton(tab: .queue, icon: "list.bullet")
                tabToggleButton(tab: .archive, icon: "checkmark.square")
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
        .onChange(of: tab) { _, _ in isReordering = false }
    }

    private func tabToggleButton(tab target: QueueTab, icon: String) -> some View {
        let isSelected = tab == target
        return Button {
            withAnimation(.easeInOut(duration: 0.25)) { tab = target }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .semibold))
                if isSelected {
                    Text(target.rawValue)
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .transition(.asymmetric(
                            insertion: .opacity.combined(with: .scale(scale: 0.8, anchor: .leading)),
                            removal: .opacity.combined(with: .scale(scale: 0.8, anchor: .leading))
                        ))
                }
            }
            .padding(.horizontal, isSelected ? 14 : 10)
            .padding(.vertical, 8)
            .background {
                if isSelected {
                    Capsule().fill(Color.accentColor.opacity(0.25))
                }
            }
            .foregroundStyle(isSelected ? Color.accentColor : .secondary)
        }
        .buttonStyle(.plain)
    }

    // MARK: - List

    private var list: some View {
        List {
            if queueVM.addingCount > 0 && tab == .queue {
                Text(queueVM.addingCount == 1 ? "Adding link…" : "Adding \(queueVM.addingCount) links…")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            if displayedItems.isEmpty {
                emptyState
                    .listRowSeparator(.hidden)
            } else {
                ForEach(displayedItems) { item in
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
                            if tab == .queue { withAnimation { isReordering = true } }
                        }
                    )
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            queueVM.delete(item)
                        } label: {
                            Text("Delete")
                        }

                        Button {
                            queueVM.setListened(item, !item.isListened)
                        } label: {
                            Text(item.isListened ? "Unarchive" : "Archive")
                        }
                        .tint(item.isListened ? .blue : .green)
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
            Text(tab == .queue ? "Your queue is empty" : "Nothing archived yet")
                .font(.title3)
                .fontWeight(.medium)
            Text(tab == .queue
                 ? "Share a link to cue. Podcast episodes play here; everything else opens in a web view."
                 : "Items you archive show up here.")
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
