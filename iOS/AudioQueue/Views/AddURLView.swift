import SwiftUI

struct AddURLView: View {
    let onAdd: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var urlText = ""
    @FocusState private var isFocused: Bool

    var isValidURL: Bool {
        guard let url = URL(string: urlText.trimmingCharacters(in: .whitespacesAndNewlines)) else { return false }
        return url.scheme == "http" || url.scheme == "https"
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Paste a link to a podcast episode, YouTube video, SoundCloud track, or any audio URL.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    TextField("https://...", text: $urlText, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .focused($isFocused)
                        .lineLimit(3...6)
                }

                Button {
                    let trimmed = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
                    onAdd(trimmed)
                    dismiss()
                } label: {
                    Label("Add to Queue", systemImage: "plus.circle.fill")
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(isValidURL ? Color.accentColor : Color.secondary.opacity(0.3))
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(!isValidURL)

                Spacer()
            }
            .padding(24)
            .navigationTitle("Add Link")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .onAppear { isFocused = true }
    }
}
