import SwiftUI
import UIKit

/// A remote image at a fixed point size, loaded through `ImagePipeline`:
/// downsampled to `pointSize × displayScale`, cached in memory and on disk,
/// shared between identical requests, and cancelled when the view goes away.
///
/// Shows `placeholder` while loading and `failure` when the URL is nil or the
/// load fails. A cached image appears on the first frame (no placeholder flash);
/// a freshly loaded one fades in unless Reduce Motion is on.
struct RemoteImage<Placeholder: View, Failure: View>: View {
    private let url: URL?
    private let pointSize: CGSize
    private let contentMode: ContentMode
    private let placeholder: () -> Placeholder
    private let failure: () -> Failure

    @Environment(\.displayScale) private var displayScale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: Phase = .empty

    init(
        url: URL?,
        pointSize: CGSize,
        contentMode: ContentMode = .fill,
        @ViewBuilder placeholder: @escaping () -> Placeholder,
        @ViewBuilder failure: @escaping () -> Failure
    ) {
        self.url = url
        self.pointSize = pointSize
        self.contentMode = contentMode
        self.placeholder = placeholder
        self.failure = failure
    }

    var body: some View {
        let key = loadKey
        let image = displayedImage(for: key)
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
                    .transition(.opacity)
            } else if case .failure(let failedKey) = phase, failedKey == key {
                failure()
            } else {
                placeholder()
            }
        }
        .frame(width: pointSize.width, height: pointSize.height)
        .clipped()
        .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: image != nil)
        .task(id: key) { await load(key) }
    }

    // MARK: - Loading

    private struct LoadKey: Hashable {
        let url: URL?
        let maxPixelSize: Int
    }

    private enum Phase {
        case empty
        case success(LoadKey, UIImage)
        case failure(LoadKey)
    }

    private var loadKey: LoadKey {
        let longestSide = max(pointSize.width, pointSize.height)
        return LoadKey(url: url, maxPixelSize: Int((longestSide * max(displayScale, 1)).rounded(.up)))
    }

    private func displayedImage(for key: LoadKey) -> UIImage? {
        if case .success(let loadedKey, let image) = phase, loadedKey == key {
            return image
        }
        guard let url = key.url else { return nil }
        return ImagePipeline.shared.cachedImage(for: url, maxPixelSize: key.maxPixelSize)?.image
    }

    private func load(_ key: LoadKey) async {
        guard let url = key.url else {
            phase = .failure(key)
            return
        }
        if let cached = ImagePipeline.shared.cachedImage(for: url, maxPixelSize: key.maxPixelSize) {
            phase = .success(key, cached.image)
            return
        }
        do {
            let decoded = try await ImagePipeline.shared.image(for: url, maxPixelSize: key.maxPixelSize)
            guard !Task.isCancelled else { return }
            phase = .success(key, decoded.image)
        } catch {
            guard !Task.isCancelled else { return }
            phase = .failure(key)
        }
    }
}

extension RemoteImage where Failure == Placeholder {
    /// Uses the placeholder for the failure state too (posters, avatars).
    init(
        url: URL?,
        pointSize: CGSize,
        contentMode: ContentMode = .fill,
        @ViewBuilder placeholder: @escaping () -> Placeholder
    ) {
        self.init(url: url, pointSize: pointSize, contentMode: contentMode, placeholder: placeholder, failure: placeholder)
    }
}

#if DEBUG
#Preview("Remote image") {
    FRPreviewCanvas {
        HStack(spacing: 12) {
            RemoteImage(url: nil, pointSize: CGSize(width: 56, height: 84)) {
                Color.frElevated
            } failure: {
                Image(systemName: "photo").foregroundStyle(Color.frTextMuted)
            }
            RemoteImage(
                url: URL(string: "https://image.tmdb.org/t/p/w185/8UlWHLMpgZm9bx6QYh0NFoq67TZ.jpg"),
                pointSize: CGSize(width: 56, height: 84)
            ) {
                Color.frElevated
            }
        }
    }
}
#endif
