import SwiftUI

enum QueueTab: String, CaseIterable {
    case queue = "Queue"
    case archive = "Archive"
}

struct QueueListView: View {
    @ObservedObject var queueVM: QueueViewModel
    @ObservedObject var playerVM: PlayerViewModel
    @ObservedObject private var engine = AudioEngine.shared

    @StateObject private var ytCookieService = YouTubeCookieService.shared
    @State private var showAddURL = false
    @State private var showYouTubeAuth = false
    @State private var currentPlayIndex = 0
    @State private var selectedTab: QueueTab = .queue
    @State private var isReordering = false

    private var displayedItems: [QueueItem] {
        selectedTab == .queue ? queueVM.sortedQueue : queueVM.archivedItems
    }

    private var isArchive: Bool { selectedTab == .archive }

    var body: some View {
        VStack(spacing: 0) {
            header

            List {
                if displayedItems.isEmpty {
                    Section {
                        if isArchive {
                            archiveEmptyState
                        } else {
                            emptyState
                        }
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                } else {
                    ForEach(displayedItems) { item in
                        QueueRowView(
                            item: item,
                            isCurrentItem: engine.currentItem?.id == item.id,
                            isPlaying: engine.isPlaying,
                            progress: progressFor(item),
                            secondsRemaining: secondsRemainingFor(item),
                            onPlayPause: item.isPlayable ? { handlePlayPause(item) } : nil,
                            onOpenInApp: item.isOpenInApp ? { handleOpenInApp(item) } : nil
                        )
                        .simultaneousGesture(
                            LongPressGesture(minimumDuration: 0.5)
                                .onEnded { _ in
                                    if !isArchive {
                                        withAnimation { isReordering = true }
                                    }
                                }
                        )
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                queueVM.delete(item)
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }

                            if isArchive {
                                Button {
                                    queueVM.markUnlistened(item)
                                } label: {
                                    Label("Unarchive", systemImage: "arrow.uturn.backward")
                                }
                                .tint(.blue)
                            } else {
                                Button {
                                    queueVM.markListened(item)
                                } label: {
                                    Label("Archive", systemImage: "archivebox")
                                }
                                .tint(.green)
                            }
                        }
                    }
                    .onMove { source, dest in
                        queueVM.moveItems(from: source, to: dest)
                    }
                }
            }
            .listStyle(.plain)
            .environment(\.editMode, isReordering ? .constant(.active) : .constant(.inactive))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .safeAreaInset(edge: .bottom) {
            if engine.currentItem != nil {
                PlayerView(playerVM: playerVM, queueVM: queueVM)
                    .transition(.move(edge: .bottom))
            }
        }
        .sheet(isPresented: $showAddURL) {
            AddURLView { urlString in
                Task {
                    await queueVM.addURL(urlString)
                }
            }
        }
        .sheet(isPresented: $showYouTubeAuth) {
            YouTubeAuthView {
                // onComplete — re-resolve will be triggered by onChange below
            }
        }
        .onChange(of: ytCookieService.isSignedIn) { _, signedIn in
            if signedIn {
                Task { await queueVM.reResolveYouTubeItems() }
            }
        }
        .onReceive(
            NotificationCenter.default.publisher(for: .playerViewModelAdvance)
        ) { _ in
            Task { await advanceQueue() }
        }
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
                Spacer()
                tabToggleButton(tab: .queue, icon: "list.bullet")
                tabToggleButton(tab: .archive, icon: "checkmark.square")
                Spacer()

                Menu {
                    if ytCookieService.isSignedIn {
                        Label("YouTube: Connected", systemImage: "checkmark.circle.fill")
                        Button(role: .destructive) {
                            ytCookieService.signOut()
                        } label: {
                            Label("Sign out of YouTube", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    } else {
                        Button {
                            showYouTubeAuth = true
                        } label: {
                            Label("Sign in to YouTube", systemImage: "play.rectangle")
                        }
                    }
                } label: {
                    Image(systemName: "gearshape")
                        .font(.headline)
                }

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
        .onChange(of: selectedTab) { _, _ in
            isReordering = false
        }
    }

    private func tabToggleButton(tab: QueueTab, icon: String) -> some View {
        let isSelected = selectedTab == tab
        return Button {
            withAnimation(.easeInOut(duration: 0.25)) {
                selectedTab = tab
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .semibold))
                if isSelected {
                    Text(tab.rawValue)
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
                    Capsule()
                        .fill(Color.accentColor.opacity(0.25))
                }
            }
            .foregroundStyle(isSelected ? Color.accentColor : .secondary)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Empty States

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "headphones")
                .font(.system(size: 60))
                .foregroundStyle(.secondary)
            Text("Your queue is empty")
                .font(.title2)
                .fontWeight(.medium)
            Text("Share a podcast, YouTube link, or audio URL\nto add it to your queue.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button {
                showAddURL = true
            } label: {
                Label("Add a URL", systemImage: "plus")
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .background(Color.accentColor)
                    .foregroundStyle(.white)
                    .clipShape(Capsule())
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var archiveEmptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "archivebox")
                .font(.system(size: 60))
                .foregroundStyle(.secondary)
            Text("No archived items")
                .font(.title2)
                .fontWeight(.medium)
            Text("Items you've listened to\nwill appear here.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Progress

    private func elapsedFor(_ item: QueueItem) -> Double? {
        if engine.currentItem?.id == item.id {
            return engine.currentTime > 0 ? engine.currentTime : nil
        }
        return engine.savedPosition(for: item.id)
    }

    private func progressFor(_ item: QueueItem) -> Double? {
        guard let totalSecs = item.durationSeconds, totalSecs > 0,
              let elapsed = elapsedFor(item) else { return nil }
        return elapsed / Double(totalSecs)
    }

    private func secondsRemainingFor(_ item: QueueItem) -> Double? {
        guard let totalSecs = item.durationSeconds, totalSecs > 0,
              let elapsed = elapsedFor(item) else { return nil }
        return max(0, Double(totalSecs) - elapsed)
    }

    // MARK: - Row Actions

    private func handlePlayPause(_ item: QueueItem) {
        if engine.currentItem?.id == item.id {
            engine.togglePlayPause()
        } else if let idx = queueVM.sortedQueue.firstIndex(where: { $0.id == item.id }) {
            currentPlayIndex = idx
            Task { await playFrom(index: idx) }
        }
    }

    private func handleOpenInApp(_ item: QueueItem) {
        // YouTube items without cookies → prompt sign-in instead of opening Safari
        if item.sourceType == "youtube" && item.audioURL == nil && !ytCookieService.isSignedIn {
            showYouTubeAuth = true
            return
        }
        if let url = URL(string: item.originalURL) {
            UIApplication.shared.open(url)
        }
    }

    // MARK: - Playback Helpers

    private func playFrom(index: Int) async {
        guard index < queueVM.sortedQueue.count else {
            print("playFrom: index \(index) out of range (\(queueVM.sortedQueue.count) items)")
            return
        }
        let item = queueVM.sortedQueue[index]
        print("playFrom: playing '\(item.title)' audioURL=\(item.audioURL ?? "nil") status=\(item.resolveStatus)")
        await playerVM.playItem(item, queueVM: queueVM)
    }

    private func advanceQueue() async {
        let nextIndex = currentPlayIndex + 1
        guard nextIndex < queueVM.sortedQueue.count else { return }
        currentPlayIndex = nextIndex
        await playFrom(index: nextIndex)
    }
}
