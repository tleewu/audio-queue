import SwiftUI

enum QueueTab: String, CaseIterable {
    case queue = "Queue"
    case archive = "Archive"
}

struct QueueListView: View {
    @ObservedObject var queueVM: QueueViewModel
    @ObservedObject var playerVM: PlayerViewModel

    @State private var showAddURL = false
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
                        Button {
                            handleTap(item)
                        } label: {
                            QueueRowView(item: item, showPlayButton: !isArchive)
                        }
                        .buttonStyle(.plain)
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
        .overlay(alignment: .bottomTrailing) {
            if selectedTab == .queue && !queueVM.sortedQueue.isEmpty && playerVM.engine.currentItem == nil {
                Button {
                    currentPlayIndex = 0
                    Task { await playFrom(index: 0) }
                } label: {
                    Image(systemName: "play.fill")
                        .font(.title2)
                        .foregroundStyle(.white)
                        .frame(width: 60, height: 60)
                        .background(Color.accentColor)
                        .clipShape(Circle())
                        .shadow(radius: 6, y: 3)
                }
                .padding(.trailing, 20)
                .padding(.bottom, 20)
            }
        }
        .safeAreaInset(edge: .bottom) {
            if playerVM.engine.currentItem != nil {
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
                Picker("", selection: $selectedTab) {
                    ForEach(QueueTab.allCases, id: \.self) { tab in
                        Text(tab.rawValue).tag(tab)
                    }
                }
                .pickerStyle(.segmented)

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

    // MARK: - Tap Handling

    private func handleTap(_ item: QueueItem) {
        if item.isUnsupported {
            if let url = URL(string: item.originalURL) {
                UIApplication.shared.open(url)
            }
        } else if let idx = queueVM.sortedQueue.firstIndex(where: { $0.id == item.id }) {
            currentPlayIndex = idx
            Task { await playFrom(index: idx) }
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
