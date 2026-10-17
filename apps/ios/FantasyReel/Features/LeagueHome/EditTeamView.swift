import FantasyReelAPI
import FantasyReelCore
import PhotosUI
import SwiftUI
import UIKit

/// Edit team (F-10): rename (trimmed, 1–100 characters) and upload, replace or
/// remove the team image. Changes show on every league screen through the
/// season store.
struct EditTeamView: View {
    @Environment(LeagueSeasonStore.self) private var store
    @Environment(ShellRouter.self) private var router
    @State private var name = ""
    @State private var didLoad = false
    @State private var save = AsyncAction()
    @State private var imageAction = AsyncAction()
    @State private var pickedItem: PhotosPickerItem?
    @State private var imageError: String?
    @FocusState private var nameFocused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                if let team = store.myTeam {
                    imageSection(team)
                    nameSection(team)
                } else {
                    EmptyStateView(title: "No team yet", message: "Your team appears once you're in the season.", systemImage: "person.2")
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .background(Color.frSheetBackground)
        .navigationTitle("Edit Team")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel", systemImage: "xmark") { router.dismissSheet() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save", systemImage: "checkmark", action: submit)
                    .disabled(!canSave)
            }
        }
        .onAppear {
            guard !didLoad, let team = store.myTeam else { return }
            name = team.team.name
            didLoad = true
        }
        .onChange(of: name) { router.sheetHasUnsavedInput = hasChanges }
        .onChange(of: pickedItem) { _, item in
            guard let item else { return }
            upload(item)
        }
        .announcesError(save.errorMessage ?? imageAction.errorMessage ?? imageError)
    }

    private func imageSection(_ team: SeasonTeam) -> some View {
        FRCard {
            HStack(spacing: 16) {
                Avatar(name: team.team.name, imageURL: team.team.avatarURL, size: .extraLarge, corners: .rounded)
                    .overlay {
                        if imageAction.isRunning {
                            ProgressView()
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                                .background(Color.black.opacity(0.4), in: RoundedRectangle(cornerRadius: 17, style: .continuous))
                        }
                    }
                VStack(alignment: .leading, spacing: 8) {
                    PhotosPicker(selection: $pickedItem, matching: .images, photoLibrary: .shared()) {
                        Text(team.team.avatarURL == nil ? "Upload Photo" : "Replace Photo")
                    }
                    .buttonStyle(.fr(.secondary, size: .compact))
                    .disabled(imageAction.isRunning)
                    if team.team.avatarURL != nil {
                        Button("Remove", role: .destructive) {
                            imageAction.run { try await store.removeMyTeamAvatar() }
                        }
                        .buttonStyle(.fr(.destructive, size: .compact))
                        .disabled(imageAction.isRunning)
                    }
                    Text("PNG, JPEG, WebP or GIF. Max 10MB.")
                        .frFont(.caption)
                        .foregroundStyle(Color.frTextSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            if let message = imageError ?? imageAction.errorMessage {
                InlineBanner(tone: .error, title: message)
                    .padding(.top, 12)
            }
        }
    }

    @ViewBuilder
    private func nameSection(_ team: SeasonTeam) -> some View {
        FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
            FormFieldRow(label: "Team name", labelWidth: 104) {
                TextField("Enter team name", text: $name)
                    .textInputAutocapitalization(.words)
                    .submitLabel(.done)
                    .focused($nameFocused)
                    .onSubmit(submit)
            }
        }
        .disabled(save.isRunning)
        HStack {
            if let validation = TeamNameRule.validate(name), hasChanges {
                Text(validation)
                    .frFont(.caption)
                    .foregroundStyle(Color.frError)
            }
            Spacer()
            Text("\(trimmed.count)/\(TeamNameRule.maxLength)")
                .frFont(.caption)
                .foregroundStyle(trimmed.count > TeamNameRule.maxLength ? Color.frError : Color.frTextSecondary)
                .monospacedDigit()
        }
        .padding(.horizontal, 4)
        if let message = save.errorMessage {
            InlineBanner(tone: .error, title: message)
        }
        Button(action: submit) {
            Text(save.isRunning ? "Saving…" : "Save")
        }
        .buttonStyle(.fr(.primary, isLoading: save.isRunning))
        .disabled(!canSave)
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var hasChanges: Bool { trimmed != (store.myTeam?.team.name ?? "") }

    private var canSave: Bool {
        hasChanges && TeamNameRule.validate(name) == nil && !save.isRunning
    }

    private func submit() {
        guard canSave else { return }
        let newName = trimmed
        save.run {
            try await store.renameMyTeam(to: newName)
            Announcer.announce("Team updated")
            router.sheetHasUnsavedInput = false
            router.dismissSheet()
        }
    }

    private func upload(_ item: PhotosPickerItem) {
        imageError = nil
        imageAction.run {
            defer { pickedItem = nil }
            guard let data = try await item.loadTransferable(type: Data.self) else {
                imageError = "Could not read that image"
                return
            }
            guard data.count <= AvatarImage.maxInputBytes else {
                imageError = "Image must be less than 10MB"
                return
            }
            guard let prepared = AvatarImage.prepare(data) else {
                imageError = "Could not read that image"
                return
            }
            try await store.setMyTeamAvatar(prepared, contentType: "image/jpeg")
            Announcer.announce("Team avatar updated")
        }
    }
}

/// Prepares a picked photo the way the web's `prepareAvatarImage` does: centre
/// crop to a square, at most 512px, metadata stripped (re-encoding drops it), a
/// GIF reduced to its first frame. JPEG at 0.85 on the surface color, since the
/// web's JPEG fallback is what every browser can read.
enum AvatarImage {
    static let maxInputBytes = 10 * 1024 * 1024
    static let maxSide: CGFloat = 512

    static func prepare(_ data: Data) -> Data? {
        guard let image = UIImage(data: data), let cgImage = image.cgImage ?? image.images?.first?.cgImage else { return nil }
        let oriented = UIImage(cgImage: cgImage, scale: 1, orientation: image.imageOrientation)
        let size = oriented.size
        let side = min(size.width, size.height)
        guard side > 0 else { return nil }
        let target = min(side, maxSide)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: target, height: target), format: format)
        let scale = target / side
        let drawSize = CGSize(width: size.width * scale, height: size.height * scale)
        let origin = CGPoint(x: (target - drawSize.width) / 2, y: (target - drawSize.height) / 2)
        let rendered = renderer.image { context in
            UIColor(red: 0x1C / 255, green: 0x1C / 255, blue: 0x1C / 255, alpha: 1).setFill()
            context.fill(CGRect(x: 0, y: 0, width: target, height: target))
            oriented.draw(in: CGRect(origin: origin, size: drawSize))
        }
        return rendered.jpegData(compressionQuality: 0.85)
    }
}
