import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Prepares a profile or team photo for upload, the same way the web does
/// (`apps/frontend/utils/avatarUpload.ts`, requirements F-03, F-10, N-09):
///
/// - center-cropped to a square of at most 512 px;
/// - EXIF orientation applied, then *every* piece of metadata dropped (GPS,
///   camera, capture time), because only the redrawn pixels are encoded;
/// - a GIF keeps its first frame; HEIC from the photo library works too;
/// - encoded as JPEG on the brand's `#1c1c1c` (iOS can read WebP but can't
///   write it; the web falls back to the same JPEG).
///
/// Pure and synchronous: call it off the main actor.
public enum AvatarImage {
    /// Largest original accepted, as on the web. The stored image is far smaller.
    public static let maxInputBytes = 10 * 1024 * 1024
    /// The `avatars` and `team-avatars` buckets reject anything larger.
    public static let maxStoredBytes = 2 * 1024 * 1024
    public static let maxSide = 512
    static let quality = 0.85
    /// Upper bound on the decoded intermediate, so a huge panorama can't
    /// exhaust memory before it is cropped.
    static let maxDecodedPixels = 4096

    public struct Prepared: Sendable, Equatable {
        public let data: Data
        public let contentType: String
        public let side: Int
    }

    public enum PrepareError: Error, Equatable, Sendable {
        /// Over `maxInputBytes`.
        case tooLarge
        /// Not an image ImageIO can read (or a file with no pixels).
        case unreadable

        /// The web's wording (`AvatarUpload.tsx`).
        public var message: String {
            switch self {
            case .tooLarge: "Image must be less than 10MB"
            case .unreadable: "Could not read that image"
            }
        }
    }

    public static func prepare(_ data: Data) throws(PrepareError) -> Prepared {
        guard data.count <= maxInputBytes else { throw .tooLarge }
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              CGImageSourceGetCount(source) > 0,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0
        else { throw .unreadable }

        // Decode just large enough that the shorter side still covers the
        // output square, with orientation applied by ImageIO.
        let shorter = min(width, height)
        let longer = max(width, height)
        let target = min(shorter, maxSide)
        let decodeSize = min(Int((Double(target) * Double(longer) / Double(shorter)).rounded(.up)), maxDecodedPixels)
        let options = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: max(decodeSize, 1),
        ] as CFDictionary
        guard let decoded = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else { throw .unreadable }

        let decodedSide = min(decoded.width, decoded.height)
        let side = min(decodedSide, maxSide)
        guard side > 0,
              let square = decoded.cropping(to: CGRect(
                  x: (decoded.width - decodedSide) / 2,
                  y: (decoded.height - decodedSide) / 2,
                  width: decodedSide,
                  height: decodedSide
              )),
              let context = CGContext(
                  data: nil,
                  width: side,
                  height: side,
                  bitsPerComponent: 8,
                  bytesPerRow: 0,
                  space: CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB(),
                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
              )
        else { throw .unreadable }

        let canvas = CGRect(x: 0, y: 0, width: side, height: side)
        // Transparent areas land on the card surface color, as on the web.
        context.setFillColor(red: 0x1C / 255, green: 0x1C / 255, blue: 0x1C / 255, alpha: 1)
        context.fill(canvas)
        context.interpolationQuality = .high
        context.draw(square, in: canvas)
        guard let redrawn = context.makeImage() else { throw .unreadable }

        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw .unreadable
        }
        CGImageDestinationAddImage(destination, redrawn, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(destination), output.length <= maxStoredBytes else { throw .unreadable }
        return Prepared(data: output as Data, contentType: "image/jpeg", side: side)
    }
}
