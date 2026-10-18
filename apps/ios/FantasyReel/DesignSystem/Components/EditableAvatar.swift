import FantasyReelAPI
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// An avatar with the gold pencil badge (V2Account profile card) that opens a
/// menu: Choose Photo, Choose File, and Remove Photo when there is one.
/// Used for the profile photo and, by the team editor, for team photos, so
/// both pick and prepare images the same way (F-03, F-10, N-09).
///
/// - Choose Photo uses the system photo picker, which needs no photo-library
///   permission: the app only sees the one photo picked.
/// - Choose File takes PNG, JPEG, WebP, GIF or HEIC from Files.
///
/// Every pick is re-encoded with `AvatarImage.prepare` (square, ≤512 px, no
/// metadata) off the main actor before `onPick` gets it; the caller uploads.
/// While `isBusy` the avatar shows a spinner and the menu is disabled.
struct EditableAvatar: View {
    let name: String
    let imageURL: String?
    var size: Avatar.Size = .profile
    var corners: Avatar.Corners = .circle
    /// "profile photo" or "team photo", for the menu's VoiceOver label.
    var subject = "profile photo"
    let isBusy: Bool
    let onPick: @MainActor (AvatarImage.Prepared) -> Void
    let onRemove: @MainActor () -> Void
    /// A pick that couldn't be read or was too large, in the web's words.
    let onError: @MainActor (String) -> Void

    @State private var showsPhotoPicker = false
    @State private var showsFileImporter = false
    @State private var photoItem: PhotosPickerItem?
    @State private var isPreparing = false

    /// The types Choose File accepts. HEIC is what iPhone photos are.
    static let fileTypes: [UTType] = [.png, .jpeg, .webP, .gif, .heic, .heif]

    var body: some View {
        let busy = isBusy || isPreparing
        ZStack(alignment: .bottomTrailing) {
            Avatar(name: name, imageURL: imageURL, size: size, corners: corners)
                .overlay {
                    if busy {
                        ZStack {
                            Color.black.opacity(0.55)
                            ProgressView().tint(.white)
                        }
                        .clipShape(corners == .circle ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: (size.points * 0.27).rounded(), style: .continuous)))
                        .accessibilityHidden(true)
                    }
                }
            Menu {
                Button("Choose Photo", systemImage: "photo.on.rectangle") { showsPhotoPicker = true }
                Button("Choose File", systemImage: "folder") { showsFileImporter = true }
                if imageURL != nil {
                    Button("Remove Photo", systemImage: "trash", role: .destructive) { onRemove() }
                }
            } label: {
                Image(systemName: "pencil")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.frGold)
                    .frame(width: 26, height: 26)
                    .background(Color.frElevated, in: Circle())
                    .overlay(Circle().stroke(Color.frBackground, lineWidth: 3))
                    // 44pt target reaching past the avatar's corner (V2Account).
                    .padding([.top, .leading], 14)
                    .padding([.bottom, .trailing], 4)
                    .contentShape(Rectangle())
            }
            .offset(x: 10, y: 10)
            .disabled(busy)
            .accessibilityLabel("Change \(subject)")
            .accessibilityValue(busy ? "Updating" : "")
        }
        .photosPicker(isPresented: $showsPhotoPicker, selection: $photoItem, matching: .images, preferredItemEncoding: .current)
        .fileImporter(isPresented: $showsFileImporter, allowedContentTypes: Self.fileTypes) { result in
            if case .success(let url) = result { prepare { try Self.readFile(url) } }
        }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            photoItem = nil
            prepare {
                guard let data = try await item.loadTransferable(type: Data.self) else { throw AvatarImage.PrepareError.unreadable }
                return data
            }
        }
    }

    /// Loads and re-encodes off the main actor, then reports back.
    private func prepare(_ load: @escaping @Sendable () async throws -> Data) {
        guard !isPreparing else { return }
        isPreparing = true
        Task {
            defer { isPreparing = false }
            do {
                let data = try await load()
                let prepared = try await Task.detached(priority: .userInitiated) {
                    try AvatarImage.prepare(data)
                }.value
                onPick(prepared)
            } catch let error as AvatarImage.PrepareError {
                onError(error.message)
            } catch is CancellationError {
                return
            } catch {
                onError(AvatarImage.PrepareError.unreadable.message)
            }
        }
    }

    /// Reads a file picked in Files, checking its size before loading it.
    private nonisolated static func readFile(_ url: URL) throws -> Data {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        if let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > AvatarImage.maxInputBytes {
            throw AvatarImage.PrepareError.tooLarge
        }
        return try Data(contentsOf: url)
    }
}

#if DEBUG
#Preview("Editable avatar") {
    FRPreviewCanvas {
        HStack(spacing: 32) {
            EditableAvatar(name: "Alice Spielberg", imageURL: nil, isBusy: false, onPick: { _ in }, onRemove: {}, onError: { _ in })
            EditableAvatar(name: "Reel Deal", imageURL: nil, size: .large, corners: .rounded, subject: "team photo", isBusy: true, onPick: { _ in }, onRemove: {}, onError: { _ in })
        }
        .padding(20)
    }
}
#endif
