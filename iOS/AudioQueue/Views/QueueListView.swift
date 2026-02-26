import SwiftUI
import SwiftData

struct QueueListView: View {
    @ObservedObject var queueVM: QueueViewModel
    @ObservedObject var playerVM: PlayerViewModel
    @Environment(\.modelContext) private var context

    @State private var showAddURL = false
    @State private var currentPlayIndex = 0

    var body: some View {
        ZStack(alignment: .bottom) {
            queueContent

            // Persistent mini-player at bottom
            if playerVM.engine.currentItem != nil {
                PlayerView(playerVM: playerVM, queueVM: queueVM)
                    .transition(.move(edge: .bottom))
            }
        }
        .navigationTitle("Queue")
        .toolbar { toolbarContent }
        .sheet(isPresented: $showAddURL) {
            AddURLView { urlString in
                Task {
                    await queueVM.addURL(urlString, context: context)
                }
            }
        }
        .onReceive(
            NotificationCenter.default.publisher(for: .playerViewModelAdvance)
        ) { _ in
            Task { await advanceQueue() }
        }
    }

    // MARK: - Queue Content

    private var queueContent: some View {
        Group {
            if queueVM.sortedQueue.isEmpty {
                emptyState
            } else {
                List {
                    ForEach(queueVM.sortedQueue) { item in
                        QueueRowView(item: item)
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    queueVM.delete(item, context: context)
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                                Button {
                                    queueVM.markListened(item, context: context)
                                } label: {
                                    Label("Done", systemImage: "checkmark.circle")
                                }
                                .tint(.green)
                            }
                            .onTapGesture {
                                if let idx = queueVM.sortedQueue.firstIndex(where: { $0.id == item.id }) {
                                    currentPlayIndex = idx
                                    Task { await playFrom(index: idx) }
                                }
                            }
                    }
                    .onMove { source, dest in
                        queueVM.moveItems(from: source, to: dest, context: context)
                    }

                    // Bottom padding so mini-player doesn't cover last row
                    Color.clear.frame(height: 90)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
                .listStyle(.plain)
                .environment(\.editMode, .constant(.active))
            }
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .navigationBarTrailing) {
            Button {
                showAddURL = true
            } label: {
                Image(systemName: "plus")
            }
        }

        ToolbarItem(placement: .navigationBarLeading) {
            if !queueVM.sortedQueue.isEmpty {
                Button {
                    currentPlayIndex = 0
                    Task { await playFrom(index: 0) }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "play.fill")
                        Text("Play All")
                    }
                }
            }
        }
    }

    // MARK: - Empty State

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

    // MARK: - Playback Helpers

    private func playFrom(index: Int) async {
        guard index < queueVM.sortedQueue.count else { return }
        let item = queueVM.sortedQueue[index]
        await playerVM.playItem(item, context: context, queueVM: queueVM)
    }

    private func advanceQueue() async {
        let nextIndex = currentPlayIndex + 1
        guard nextIndex < queueVM.sortedQueue.count else { return }
        currentPlayIndex = nextIndex
        await playFrom(index: nextIndex)
    }
}
