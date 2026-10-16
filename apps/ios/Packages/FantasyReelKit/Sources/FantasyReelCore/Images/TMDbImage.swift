import Foundation

/// TMDb poster widths. Pick roughly 2–3× the point size for Retina
/// (a 36×54 row poster → `w154`; a detail hero → `w500`).
public enum TMDbImageSize: String, CaseIterable, Sendable, Hashable {
    case w92, w154, w185, w342, w500, w780, original
}

/// Poster URLs, ported from the web's `getTmdbPosterUrl`
/// (`apps/frontend/utils/movie-posters.ts`).
public enum TMDbImage {
    private static let origin = "https://image.tmdb.org"

    /// The poster at `size`, from whatever `movies.poster_url` holds: a bare
    /// TMDb path (`/abc.jpg`), a TMDb URL at any size, or another host's URL.
    ///
    /// Differences from the web: a relative app path (`/brand/x.png`) has no web
    /// origin to resolve against on iOS, so it returns nil (show the
    /// placeholder). Other hosts' URLs are passed through as on the web.
    public static func posterURL(_ posterUrl: String?, size: TMDbImageSize = .w500) -> URL? {
        guard let source = posterUrl?.trimmingCharacters(in: .whitespacesAndNewlines), !source.isEmpty else {
            return nil
        }

        if isPosterPath(source) { return URL(string: "\(origin)/t/p/\(size.rawValue)\(source)") }
        if source.hasPrefix("/") { return nil }

        guard let components = URLComponents(string: source),
              let scheme = components.scheme?.lowercased(),
              scheme == "https" || scheme == "http",
              let host = components.host?.lowercased(), !host.isEmpty
        else { return nil }

        guard host == "image.tmdb.org" else { return URL(string: source) }

        // `/t/p/<w123|original>/<file>`: re-size it.
        let prefix = "/t/p/"
        let path = components.percentEncodedPath
        guard path.hasPrefix(prefix) else { return nil }
        let afterPrefix = path.dropFirst(prefix.count)
        guard let slash = afterPrefix.firstIndex(of: "/") else { return nil }
        let sizeSegment = afterPrefix[afterPrefix.startIndex..<slash]
        let file = String(afterPrefix[slash...])
        guard isSizeSegment(sizeSegment), isPosterPath(file) else { return nil }
        return URL(string: "\(origin)/t/p/\(size.rawValue)\(file)")
    }

    /// `^/[^/?#]+\.(?:jpe?g|png|webp)$` (case-insensitive), as on the web.
    static func isPosterPath(_ path: String) -> Bool {
        guard path.hasPrefix("/") else { return false }
        let name = path.dropFirst()
        guard !name.isEmpty, !name.contains(where: { $0 == "/" || $0 == "?" || $0 == "#" }) else { return false }
        let lower = name.lowercased()
        for ext in [".jpg", ".jpeg", ".png", ".webp"] where lower.hasSuffix(ext) {
            return lower.count > ext.count
        }
        return false
    }

    /// `w\d+` or `original`.
    private static func isSizeSegment(_ segment: Substring) -> Bool {
        if segment == "original" { return true }
        guard segment.first == "w" else { return false }
        let digits = segment.dropFirst()
        return !digits.isEmpty && digits.allSatisfy { $0.isASCII && $0.isNumber }
    }
}
