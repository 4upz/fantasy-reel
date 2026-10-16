import FantasyReelCore
import SwiftUI

/// A movie poster: the TMDb image at a size suited to the display, over the
/// mockups' `.poster` placeholder (a deterministic colored tile with the
/// title's initials) while loading or when there is no poster.
///
/// Decorative for VoiceOver: the row or header next to it carries the title.
struct PosterImage: View {
    private let posterURL: String?
    private let title: String
    private let size: CGSize
    private let tmdbSize: TMDbImageSize?
    private let cornerRadius: CGFloat?

    @Environment(\.displayScale) private var displayScale

    /// - Parameters:
    ///   - posterURL: the `poster_url` value (a TMDb path or full URL).
    ///   - size: display size in points; defaults to the 36×54 row thumbnail.
    ///   - tmdbSize: override the TMDb rendition; by default the smallest one at
    ///     least as wide as `size.width × displayScale` (w154 for a 3x row thumb).
    init(
        posterURL: String?,
        title: String,
        size: CGSize = FRMetrics.posterThumb,
        tmdbSize: TMDbImageSize? = nil,
        cornerRadius: CGFloat? = nil
    ) {
        self.posterURL = posterURL
        self.title = title
        self.size = size
        self.tmdbSize = tmdbSize
        self.cornerRadius = cornerRadius
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: resolvedCornerRadius, style: .continuous)
        RemoteImage(url: TMDbImage.posterURL(posterURL, size: resolvedTMDbSize), pointSize: size) {
            PosterPlaceholder(title: title, size: size)
        }
        .clipShape(shape)
        .overlay(shape.strokeBorder(Color.white.opacity(0.12), lineWidth: 0.5))
        .accessibilityHidden(true)
    }

    private var resolvedCornerRadius: CGFloat {
        if let cornerRadius { return cornerRadius }
        switch size.width {
        case ..<48: return FRMetrics.posterThumbRadius
        case ..<80: return 6
        default: return 12
        }
    }

    private var resolvedTMDbSize: TMDbImageSize {
        if let tmdbSize { return tmdbSize }
        let pixels = size.width * max(displayScale, 1)
        switch pixels {
        case ...92: return .w92
        case ...154: return .w154
        case ...185: return .w185
        case ...342: return .w342
        case ...500: return .w500
        default: return .w780
        }
    }
}

/// The `.poster` placeholder tile: one of eight muted fills chosen from the
/// title, with initials in the lower-leading corner.
struct PosterPlaceholder: View {
    let title: String
    let size: CGSize

    var body: some View {
        let tiles = Color.frPosterTiles
        ZStack(alignment: .bottomLeading) {
            tiles[FRInitials.stableIndex(for: title, count: tiles.count)]
            Text(FRInitials.make(from: title))
                .font(FRFonts.fixedFont(.bricolage, weight: 700, size: min(max(size.width * 0.22, 8), 14)))
                .foregroundStyle(Color.white.opacity(0.85))
                .lineLimit(1)
                .padding(size.width < 48 ? 3 : 6)
        }
        .frame(width: size.width, height: size.height)
        .accessibilityHidden(true)
    }
}

/// Initials and stable color picks for placeholders. `String.hashValue` is
/// randomized per launch, so colors use a fixed hash of the scalars instead.
nonisolated enum FRInitials {
    private static let skipped: Set<String> = ["the", "a", "an", "of", "in", "on", "and", "at", "to", "&"]

    /// "The Hunger Games: Sunrise…" → "HG", "The Odyssey" → "TO", "Jumanji 3" → "J3",
    /// "Michael" → "MI", "Alice Spielberg" → "AS".
    static func make(from text: String) -> String {
        let words = text
            .split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .map(String.init)
        guard !words.isEmpty else { return "?" }
        let significant = words.filter { !skipped.contains($0.lowercased()) }
        let chosen = significant.count >= 2 ? significant : words
        if chosen.count >= 2 {
            return String(chosen[0].prefix(1) + chosen[1].prefix(1)).uppercased()
        }
        return String(chosen[0].prefix(2)).uppercased()
    }

    static func stableIndex(for text: String, count: Int) -> Int {
        guard count > 0 else { return 0 }
        var hash: UInt64 = 5381
        for scalar in text.unicodeScalars {
            hash = (hash &* 33) &+ UInt64(scalar.value)
        }
        return Int(hash % UInt64(count))
    }
}

#if DEBUG
#Preview("Posters") {
    FRPreviewCanvas {
        HStack(alignment: .bottom, spacing: 12) {
            ForEach(FRSampleData.movies) { movie in
                PosterImage(posterURL: nil, title: movie.title)
            }
        }
        PosterImage(posterURL: nil, title: "Street Fighter", size: CGSize(width: 96, height: 144))
    }
}
#endif
