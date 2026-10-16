import SwiftUI
import UIKit

/// A remote image at a fixed point size, loaded through `ImagePipeline`:
/// downsampled to `pointSize × displayScale`, cached in memory and on disk,
/// shared between identical requests, and cancelled when the view goes away.
///
/// Shows `placeholder` while loading and `failure` when the URL is nil or the
/// load fails. A cached image appears on the first frame (no placeholder flash);
/// a freshly loaded one fades in unless Reduce Motion is on. The view holds no
/// bitmap of its own: it reads the image from the pipeline's memory cache on
/// each render and reloads if the cache has evicted it.
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
        let image = cachedImage(for: key)
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
                    .transition(.opacity)
            } else if phase == .failed(key) {
                failure()
            } else {
                placeholder()
            }
        }
        .frame(width: pointSize.width, height: pointSize.height)
        .clipped()
        .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: image != nil)
        // Keyed on whether the image is in memory too: if the cache evicts it,
        // the next render misses and the task reloads it.
        .task(id: LoadRequest(key: key, isCached: image != nil)) {
            await load(key)
        }
    }

    // MARK: - Loading

    private struct LoadKey: Hashable {
        let url: URL?
        let maxPixelSize: Int
    }

    private struct LoadRequest: Hashable {
        let key: LoadKey
        let isCached: Bool
    }

    /// Only which load finished, never the image itself: the decoded image
    /// lives in `ImagePipeline`'s memory cache and `body` reads it from there,
    /// so a view never pins a bitmap the cache has evicted.
    private enum Phase: Equatable {
        case empty
        /// The count makes a reload after eviction a real state change.
        case loaded(LoadKey, Int)
        case failed(LoadKey)
    }

    private var loadKey: LoadKey {
        let longestSide = max(pointSize.width, pointSize.height)
        return LoadKey(url: url, maxPixelSize: Int((longestSide * max(displayScale, 1)).rounded(.up)))
    }

    private func cachedImage(for key: LoadKey) -> UIImage? {
        guard let url = key.url else { return nil }
        return ImagePipeline.shared.cachedImage(for: url, maxPixelSize: key.maxPixelSize)?.image
    }

    private func load(_ key: LoadKey) async {
        guard let url = key.url else {
            if phase != .failed(key) { phase = .failed(key) }
            return
        }
        // A cache hit is already on screen; changing state here would only
        // cost a second render.
        if ImagePipeline.shared.cachedImage(for: url, maxPixelSize: key.maxPixelSize) != nil {
            return
        }
        do {
            _ = try await ImagePipeline.shared.image(for: url, maxPixelSize: key.maxPixelSize)
            guard !Task.isCancelled else { return }
            // Triggers the render that reads the now-cached image.
            var count = 0
            if case .loaded(_, let previous) = phase { count = previous &+ 1 }
            phase = .loaded(key, count)
        } catch {
            guard !Task.isCancelled else { return }
            phase = .failed(key)
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
