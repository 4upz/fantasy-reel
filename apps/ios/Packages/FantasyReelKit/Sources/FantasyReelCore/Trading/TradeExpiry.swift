import Foundation

/// The offer-window rules (`trade-expiry.ts` and the web's `useOfferExpiry`).
/// The server re-checks everything; these drive the picker.
public struct TradeExpiryBounds: Sendable, Hashable {
    public static let defaultHours = 48
    public static let minimumMinutes = 60
    public static let maximumDays = 14

    public let defaultHours: Int
    public let minMinutes: Int
    public let maxDays: Int

    /// League overrides, with the default clamped into the window as the web does.
    public init(league: League) {
        self.init(
            defaultHours: league.tradeOfferExpiryDefaultHours,
            minHours: league.tradeOfferExpiryMinHours,
            maxDays: league.tradeOfferExpiryMaxDays
        )
    }

    public init(defaultHours: Int? = nil, minHours: Int? = nil, maxDays: Int? = nil) {
        let minMinutes = (minHours ?? 1) * 60
        let maxDays = maxDays ?? Self.maximumDays
        let rawDefault = defaultHours ?? Self.defaultHours
        self.minMinutes = minMinutes
        self.maxDays = maxDays
        self.defaultHours = min(max(rawDefault, Int((Double(minMinutes) / 60).rounded(.up))), maxDays * 24)
    }

    /// Picker presets: 24h, 48h, 3 days, 7 days and the league default, inside the window.
    public var presets: [Int] {
        Set([24, 48, 72, 168, defaultHours])
            .filter { $0 * 60 >= minMinutes && $0 <= maxDays * 24 }
            .sorted()
    }

    /// Hours to add to the current expiry, kept only while still inside the
    /// window measured from now (`extendPresetsFor`).
    public func extendPresets(currentExpiry: Date, now: Date = Date()) -> [Int] {
        let latest = now.addingTimeInterval(TimeInterval(maxDays) * 86_400)
        return [12, 24, 48, 72].filter { currentExpiry.addingTimeInterval(TimeInterval($0) * 3600) <= latest }
    }

    /// "24h", "48h", "3 days", "7 days".
    public static func label(hours: Int) -> String {
        hours >= 72 && hours % 24 == 0 ? "\(hours / 24) days" : "\(hours)h"
    }

    public var maxDaysText: String { "\(maxDays) \(maxDays == 1 ? "day" : "days")" }

    /// "1 hour", "6 hours", "30 minutes".
    public var minWindowText: String {
        if minMinutes % 60 == 0 {
            let hours = minMinutes / 60
            return "\(hours) \(hours == 1 ? "hour" : "hours")"
        }
        return "\(minMinutes) minutes"
    }
}

/// How the offer's expiry was chosen in the composer.
public enum TradeExpiryChoice: Sendable, Hashable {
    case preset(hours: Int)
    /// Until a movie in the trade releases (nil: the soonest).
    case release(movieID: MovieID?)
    case custom(Date)
    case none
}

/// What propose/counter send: `expires_at`, `expiry_anchor`, `expiry_anchor_movie_id`.
public struct TradeExpiryRequest: Sendable, Hashable {
    public var expiresAt: Date?
    public var anchor: String?
    public var anchorMovieID: MovieID?

    public static let noExpiry = TradeExpiryRequest(expiresAt: nil, anchor: nil, anchorMovieID: nil)
}

/// A movie the offer can wait on: unreleased, with its release boundary (the
/// start of the next UTC day) inside the window.
public struct TradeReleaseCandidate: Sendable, Hashable, Identifiable {
    public let movieID: MovieID
    public let title: String
    public let releaseDate: DateOnly
    public let boundary: Date

    public var id: MovieID { movieID }
}

public enum TradeExpiry {
    /// Start of the day after `date`, UTC: when a release-anchored offer lapses.
    public static func releaseBoundary(_ date: DateOnly) -> Date {
        date.date(in: .gmt).addingTimeInterval(86_400)
    }

    /// The release candidates among the selected movies, soonest first, or why
    /// there are none.
    public static func releaseCandidates(
        _ movies: [(movieID: MovieID, title: String, releaseDate: DateOnly?)],
        bounds: TradeExpiryBounds,
        now: Date = Date()
    ) -> Result<[TradeReleaseCandidate], ReleaseUnavailable> {
        guard !movies.isEmpty else { return .failure(.noMovies) }
        var seen = Set<MovieID>()
        let upcoming = movies.compactMap { movie -> TradeReleaseCandidate? in
            guard let date = movie.releaseDate, seen.insert(movie.movieID).inserted else { return nil }
            let boundary = releaseBoundary(date)
            guard boundary > now else { return nil }
            return TradeReleaseCandidate(movieID: movie.movieID, title: movie.title, releaseDate: date, boundary: boundary)
        }.sorted { $0.boundary < $1.boundary }
        guard let soonest = upcoming.first else { return .failure(.noneUnreleased) }
        let earliest = now.addingTimeInterval(TimeInterval(bounds.minMinutes) * 60)
        let latest = now.addingTimeInterval(TimeInterval(bounds.maxDays) * 86_400)
        let inWindow = upcoming.filter { $0.boundary >= earliest && $0.boundary <= latest }
        if inWindow.isEmpty {
            return .failure(soonest.boundary < earliest ? .tooSoon(soonest.title) : .tooFar(bounds.maxDaysText))
        }
        return .success(inWindow)
    }

    public enum ReleaseUnavailable: Error, Sendable, Hashable {
        case noMovies
        case noneUnreleased
        case tooFar(String)
        case tooSoon(String)
        /// The chosen movie left the trade (or its release moved out of range).
        case choiceUnavailable

        public var reason: String {
            switch self {
            case .noMovies: "Add a movie to use this"
            case .noneUnreleased: "Nothing in this trade is still unreleased"
            case .tooFar(let days): "Nothing in this trade releases within \(days)"
            case .tooSoon(let title): "\(title) is out too soon"
            case .choiceUnavailable: "That movie can't set the expiry any more. Choose another."
            }
        }
    }

    public enum ResolveError: Error, Sendable, Hashable {
        case tooSoon(String)
        case tooLate(String)
        case release(ReleaseUnavailable)

        public var message: String {
            switch self {
            case .tooSoon(let window): "An offer has to stay open at least \(window)"
            case .tooLate(let days): "An offer cannot stay open longer than \(days)"
            case .release(let reason): reason.reason
            }
        }
    }

    /// The request for a choice (`resolveExpiryChoice`), re-run at submit.
    public static func resolve(
        _ choice: TradeExpiryChoice,
        candidates: Result<[TradeReleaseCandidate], ReleaseUnavailable>,
        bounds: TradeExpiryBounds,
        now: Date = Date()
    ) -> Result<TradeExpiryRequest, ResolveError> {
        switch choice {
        case .none:
            return .success(.noExpiry)
        case .preset(let hours):
            return .success(TradeExpiryRequest(expiresAt: now.addingTimeInterval(TimeInterval(hours) * 3600), anchor: "fixed", anchorMovieID: nil))
        case .release(let movieID):
            switch candidates {
            case .failure(let reason):
                return .failure(.release(reason))
            case .success(let list):
                // A movie that dropped out of the trade is refused, never
                // swapped for another one (the server refuses that too).
                let chosen = movieID == nil ? list.first : list.first { $0.movieID == movieID }
                guard let chosen else {
                    return .failure(.release(.choiceUnavailable))
                }
                return .success(TradeExpiryRequest(expiresAt: chosen.boundary, anchor: "movie_release", anchorMovieID: chosen.movieID))
            }
        case .custom(let date):
            let zeroed = Date(timeIntervalSince1970: (date.timeIntervalSince1970 / 60).rounded(.down) * 60)
            if zeroed < now.addingTimeInterval(TimeInterval(bounds.minMinutes) * 60) {
                return .failure(.tooSoon(bounds.minWindowText))
            }
            if zeroed > now.addingTimeInterval(TimeInterval(bounds.maxDays) * 86_400) {
                return .failure(.tooLate(bounds.maxDaysText))
            }
            return .success(TradeExpiryRequest(expiresAt: zeroed, anchor: "fixed", anchorMovieID: nil))
        }
    }

    /// "Sat, Aug 22, 4:15 PM" (`formatExpiryAbsolute`).
    public static func absolute(_ date: Date, locale: Locale = .autoupdatingCurrent, timeZone: TimeZone = .autoupdatingCurrent) -> String {
        var style = Date.FormatStyle(locale: locale, timeZone: timeZone)
        style = style.weekday(.abbreviated).month(.abbreviated).day().hour().minute()
        return date.formatted(style)
    }

    /// How urgent an expiry is, for the pill's tone.
    public enum Urgency: Sendable, Hashable {
        case lapsed, urgent, soon, relaxed
    }

    public static func urgency(_ expiresAt: Date, now: Date = Date()) -> Urgency {
        let remaining = expiresAt.timeIntervalSince(now)
        if remaining <= 0 { return .lapsed }
        if remaining < 2 * 3600 { return .urgent }
        if remaining < 24 * 3600 { return .soon }
        return .relaxed
    }
}
