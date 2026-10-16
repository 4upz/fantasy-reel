import Foundation
import ImageIO
import UIKit

/// Image loading for posters and avatars (N-09).
///
/// - Memory: an `NSCache` of *decoded, downsampled* images, cost-limited by bytes.
/// - Disk: a dedicated `URLCache` (100 MB) under Caches, honoring HTTP cache
///   headers, so a revisited poster is not re-downloaded. Poster and avatar URLs
///   are public and carry no credentials, so the cache is not keyed by user.
/// - Downsampling: ImageIO decodes straight to the requested pixel size (point
///   size × display scale), so a 36pt row never holds a 780px poster in memory.
/// - De-duplication: concurrent requests for the same URL and size share one
///   download. The download is cancelled when its last waiter is cancelled
///   (`RemoteImage` uses `.task(id:)`, which cancels when the view disappears).
actor ImagePipeline {
    static let shared = ImagePipeline()

    /// Decoded-image memory cache; thread-safe, so readable without hopping onto the actor.
    let memoryCache: ImageMemoryCache

    private let session: URLSession
    private var inFlight: [String: InFlight] = [:]

    private struct InFlight {
        let id: UUID
        let task: Task<DecodedImage, Error>
        var waiters: Int
    }

    init(memoryCostLimit: Int = 48 * 1024 * 1024, diskCapacity: Int = 100 * 1024 * 1024) {
        memoryCache = ImageMemoryCache(costLimit: memoryCostLimit)

        let configuration = URLSessionConfiguration.default
        let directory = FileManager.default
            .urls(for: .cachesDirectory, in: .userDomainMask)
            .first?
            .appendingPathComponent("FRImageCache", isDirectory: true)
        configuration.urlCache = URLCache(
            memoryCapacity: 4 * 1024 * 1024,
            diskCapacity: diskCapacity,
            directory: directory
        )
        configuration.requestCachePolicy = .useProtocolCachePolicy
        configuration.timeoutIntervalForRequest = 30
        configuration.httpMaximumConnectionsPerHost = 6
        session = URLSession(configuration: configuration)
    }

    /// A decoded image already in memory, or nil. Synchronous, so a view can show
    /// a cached image on its first frame without flashing the placeholder.
    nonisolated func cachedImage(for url: URL, maxPixelSize: Int) -> DecodedImage? {
        memoryCache.image(forKey: Self.cacheKey(url, maxPixelSize))
    }

    /// Loads, downsamples and caches the image at `url` so its longest side is at
    /// most `maxPixelSize` pixels. Throws `CancellationError` when the calling
    /// task is cancelled and no other caller still wants the image.
    func image(for url: URL, maxPixelSize: Int) async throws -> DecodedImage {
        let key = Self.cacheKey(url, maxPixelSize)
        if let cached = memoryCache.image(forKey: key) { return cached }

        let entry: InFlight
        if var existing = inFlight[key] {
            existing.waiters += 1
            inFlight[key] = existing
            entry = existing
        } else {
            let session = self.session
            let cache = memoryCache
            let task = Task.detached(priority: .userInitiated) { () async throws -> DecodedImage in
                let (data, response) = try await session.data(from: url)
                try Task.checkCancellation()
                if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                    throw URLError(.badServerResponse)
                }
                guard let image = ImagePipeline.downsample(data, maxPixelSize: maxPixelSize) else {
                    throw URLError(.cannotDecodeContentData)
                }
                cache.insert(image, forKey: key)
                return image
            }
            entry = InFlight(id: UUID(), task: task, waiters: 1)
            inFlight[key] = entry
        }

        let id = entry.id
        let task = entry.task
        defer { finish(key: key, id: id) }
        return try await withTaskCancellationHandler {
            try await task.value
        } onCancel: {
            Task { await self.waiterCancelled(key: key, id: id) }
        }
    }

    // MARK: - Private

    private func finish(key: String, id: UUID) {
        if inFlight[key]?.id == id {
            inFlight[key] = nil
        }
    }

    private func waiterCancelled(key: String, id: UUID) {
        guard var entry = inFlight[key], entry.id == id else { return }
        entry.waiters -= 1
        if entry.waiters <= 0 {
            entry.task.cancel()
            inFlight[key] = nil
        } else {
            inFlight[key] = entry
        }
    }

    private nonisolated static func cacheKey(_ url: URL, _ maxPixelSize: Int) -> String {
        "\(url.absoluteString)#\(maxPixelSize)"
    }

    /// Decodes `data` directly at thumbnail size with ImageIO, applying EXIF orientation.
    nonisolated static func downsample(_ data: Data, maxPixelSize: Int) -> DecodedImage? {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else { return nil }
        let thumbnailOptions = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, maxPixelSize),
        ] as CFDictionary
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnailOptions) else { return nil }
        return DecodedImage(image: UIImage(cgImage: cgImage), cost: cgImage.bytesPerRow * cgImage.height)
    }
}

/// A decoded image plus its memory cost.
///
/// `@unchecked Sendable`: both properties are immutable `let`s and `UIImage` is
/// immutable and safe to read from any thread once created.
nonisolated final class DecodedImage: @unchecked Sendable {
    let image: UIImage
    let cost: Int

    init(image: UIImage, cost: Int) {
        self.image = image
        self.cost = cost
    }
}

/// Byte-cost-limited memory cache of decoded images.
///
/// `@unchecked Sendable`: the only stored property is an `NSCache`, which is
/// documented as thread-safe; this wrapper adds no mutable state. NSCache also
/// evicts on its own under memory pressure.
nonisolated final class ImageMemoryCache: @unchecked Sendable {
    private let cache = NSCache<NSString, DecodedImage>()

    init(costLimit: Int) {
        cache.totalCostLimit = costLimit
        cache.countLimit = 400
    }

    func image(forKey key: String) -> DecodedImage? {
        cache.object(forKey: key as NSString)
    }

    func insert(_ image: DecodedImage, forKey key: String) {
        cache.setObject(image, forKey: key as NSString, cost: image.cost)
    }

    func removeAll() {
        cache.removeAllObjects()
    }
}
