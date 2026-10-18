import Foundation

// MARK: - Weekly window

/// Where the weekly bidding cycle stands (port of `_shared/bid-window.ts` and
/// the web's `getBidPhase`).
///
/// The cycle ends at the processing deadline (Saturday 20:00 UTC). A cutoff
/// `new_bid_cutoff_hours` before it splits the week: before it, bid on
/// anything; after it, only raise or counter movies already being bid on, and
/// nothing can be cancelled. The cutoff instant comes from the server
/// (`get_new_bid_cutoff`), so the client never re-derives "next Saturday".
public struct BidWeek: Sendable, Hashable {
    public static let cycleHours: Double = 168

    /// When this week's bids process.
    public let processingDeadline: Date?
    /// When new bids stop, or nil when the league has the cutoff off.
    public let cutoffAt: Date?

    public init(processingDeadline: Date?, cutoffAt: Date?) {
        self.processingDeadline = processingDeadline
        self.cutoffAt = cutoffAt
    }

    /// True once the cutoff has passed (inclusive): raises and counters only.
    public func isCounterBidPhase(now: Date = Date()) -> Bool {
        guard let cutoffAt else { return false }
        return cutoffAt <= now
    }

    /// Fractions of the week for the timeline bar (cutoff notch, elapsed fill).
    public func fractions(now: Date = Date()) -> (cutoff: Double, elapsed: Double)? {
        guard let cutoffAt, let processingDeadline else { return nil }
        let cycle = Self.cycleHours * 3600
        let start = processingDeadline.addingTimeInterval(-cycle)
        func clamp(_ value: Double) -> Double { min(1, max(0, value)) }
        return (
            clamp(cutoffAt.timeIntervalSince(start) / cycle),
            clamp(now.timeIntervalSince(start) / cycle)
        )
    }

    /// Whether one of my pending bids can be withdrawn now. Two locks: the
    /// week's cutoff, and the bid's own processing deadline (a contest held
    /// past Saturday by a counter window must not be abandoned in the gap).
    public func canCancel(bidProcessingDeadline: Date, now: Date = Date()) -> Bool {
        if isCounterBidPhase(now: now) { return false }
        return bidProcessingDeadline > now
    }
}

/// Countdown and deadline wording for bid rows.
public enum BidTiming {
    /// "2d 5h", "3h 42m", or "Processing soon" once past (`formatTimeRemaining`).
    public static func timeRemaining(until deadline: Date?, now: Date = Date()) -> String {
        guard let deadline else { return "Processing soon" }
        let diff = deadline.timeIntervalSince(now)
        guard diff > 0 else { return "Processing soon" }
        let hours = Int(diff / 3600)
        let minutes = Int(diff.truncatingRemainder(dividingBy: 3600) / 60)
        if hours > 24 { return "\(hours / 24)d \(hours % 24)h" }
        return "\(hours)h \(minutes)m"
    }

    /// "2d 4h to counter", or "Processing soon" once the window has closed.
    public static func counterTimeLeft(until deadline: Date?, now: Date = Date()) -> String {
        let remaining = timeRemaining(until: deadline, now: now)
        guard let deadline, deadline > now else { return remaining }
        return "\(remaining) to counter"
    }

    /// The latest still-open counter-response window among a contest's bids.
    /// While one is open, processing holds the whole contest past Saturday.
    public static func latestOpenCounterWindow(_ deadlines: [Date?], now: Date = Date()) -> Date? {
        deadlines.compactMap { $0 }.filter { $0 > now }.max()
    }

    /// "Thu 8:00 PM" in the viewer's time zone (`formatDeadlineShort`).
    public static func shortDeadline(_ date: Date, locale: Locale = .autoupdatingCurrent, timeZone: TimeZone = .autoupdatingCurrent) -> String {
        var style = Date.FormatStyle(locale: locale, timeZone: timeZone)
        style = style.weekday(.abbreviated).hour(.defaultDigits(amPM: .abbreviated)).minute(.twoDigits)
        return date.formatted(style)
    }
}

/// A movie can still be bid on or counterpicked: known release date, not past
/// (UTC). Mirrors `isMovieBiddable` / the server's release guard.
public enum BidEligibility {
    public static func isBiddable(releaseDate: DateOnly?, now: Date = Date()) -> Bool {
        guard let releaseDate else { return false }
        return releaseDate >= DateOnly.today(now: now)
    }
}

// MARK: - Amounts

/// The place-bid amount rule: a whole number 0…100, within the remaining
/// budget, and above the current high bid. Messages match the web sheet.
public enum BidAmountRule {
    public static let maximum = 100

    /// The first problem with `amount`, or nil when it can be sent.
    public static func problem(amount: Int, remainingBudget: Int?, highBid: Int?) -> String? {
        guard let remainingBudget else { return "Your budget is unavailable. Close this and try again." }
        if amount > remainingBudget { return "Exceeds your budget of $\(remainingBudget)" }
        if amount > maximum { return "Maximum bid is $\(maximum)" }
        if let highBid, amount <= highBid { return "Must be higher than current bid of $\(highBid)" }
        if amount < 0 { return "Bid must be $0 or more" }
        return nil
    }

    /// Where the amount starts: one above the high bid, or $0 uncontested.
    public static func initialAmount(highBid: Int?) -> Int { highBid.map { $0 + 1 } ?? 0 }
}

// MARK: - Fit forecast

/// How a winning bid would find room on the roster.
public enum BidFunding: Sendable, Hashable {
    case slot
    case drop
}

/// The client forecast of which pending pickup bids would fit if they all won
/// (port of `bidFitForecast.ts`, mirroring `consume()` in the resolver). A
/// forecast, not a promise: budget, rival bids and target changes are settled
/// by the server.
public enum BidFitForecast {
    /// Holdings a conditional drop could still release: not released before
    /// today (UTC), and when the league blocks it, not counterpicked or under an
    /// open counterpick bid. Keeps the input order.
    public static func droppableHoldingIDs(
        _ holdings: [TeamHolding],
        today: DateOnly,
        counterpicksBlockDrops: Bool,
        contestedMovieIDs: Set<MovieID>
    ) -> [HoldingID] {
        holdings.filter { holding in
            if let release = holding.releaseDate, release < today { return false }
            if counterpicksBlockDrops {
                if holding.counterpickedByTeamID != nil { return false }
                if contestedMovieIDs.contains(holding.movieID) { return false }
            }
            return true
        }.map(\.holdingID)
    }

    /// Walks bids in priority order. A free slot is used first, even by a bid
    /// with a conditional drop; with no slot left a bid needs an eligible drop
    /// target and drop allowance, and each holding drops once.
    ///
    /// - Parameter dropTargets: each bid's conditional drop, in priority order.
    /// - Returns: how each bid gets room, or nil when it can't fit now.
    public static func forecast<ID: Hashable>(
        dropTargets: [ID?],
        freeSlots: Int,
        remainingDrops: Int,
        droppable: Set<ID>
    ) -> [BidFunding?] {
        var slotsLeft = freeSlots
        var dropsLeft = remainingDrops
        var droppable = droppable
        return dropTargets.map { target in
            if slotsLeft > 0 {
                slotsLeft -= 1
                return .slot
            }
            if let target, dropsLeft > 0, droppable.contains(target) {
                dropsLeft -= 1
                droppable.remove(target)
                return .drop
            }
            return nil
        }
    }
}

// MARK: - History

/// One team's settled bid within a contest.
public struct BidHistoryEntry: Sendable, Hashable {
    public let bidID: BidID
    public let teamID: TeamID
    public let amount: Int
    public let reason: BidResolutionReason?
}

/// One settled contest: who won it (if anyone) and who else bid.
public struct BidHistoryResult: Sendable, Hashable, Identifiable {
    public enum Kind: Sendable, Hashable { case pickup, counterpick }

    public let kind: Kind
    public let id: String
    public let title: String
    public let posterURL: String?
    public let releaseDate: DateOnly?
    public let winner: BidHistoryEntry?
    /// Beaten bids, highest first.
    public let losers: [BidHistoryEntry]
    /// Counterpicks only: whose movie was targeted.
    public let targetTeamID: TeamID?

    /// "won by $3", "tied, won on the earlier bid", "no other bids".
    public var marginText: String? {
        guard let winner else { return nil }
        guard let top = losers.first else { return "no other bids" }
        let margin = winner.amount - top.amount
        return margin == 0 ? "tied, won on the earlier bid" : "won by $\(margin)"
    }
}

/// One processing day's results.
public struct BidHistoryRound: Sendable, Hashable, Identifiable {
    /// The UTC day the round processed.
    public let date: DateOnly
    public let results: [BidHistoryResult]

    public var id: DateOnly { date }
}

/// Groups settled bids into contests and rounds (port of `bidHistory.ts`).
public enum BidHistory {
    /// Bids on one movie within a week of each other settled together: a
    /// contest held past Saturday carries its late counter on the next one.
    static let contestWindow: TimeInterval = 7 * 24 * 3600

    private struct Resolved {
        let kind: BidHistoryResult.Kind
        let movieKey: String
        let entry: BidHistoryEntry
        let won: Bool
        let processingDeadline: Date
        let title: String
        let posterURL: String?
        let releaseDate: DateOnly?
        let targetTeamID: TeamID?
    }

    private struct Contest {
        var bids: [Resolved]
        var settledAt: Date
        var hasWinner: Bool
    }

    /// Newest round first; within a round the priciest contest first. Pass only
    /// `won`/`lost` bids: cancelled and pending ones have no result.
    public static func group(pickupBids: [PickupBid], counterpickBids: [CounterpickBid]) -> [BidHistoryRound] {
        let resolved: [Resolved] = pickupBids.map { bid in
            Resolved(
                kind: .pickup, movieKey: "pickup:\(bid.tmdbID.rawValue)",
                entry: BidHistoryEntry(bidID: bid.id, teamID: bid.teamID, amount: bid.amount, reason: bid.resolutionReason),
                won: bid.status == .won, processingDeadline: bid.processingDeadline,
                title: bid.movieData?.title ?? "Unknown movie", posterURL: bid.posterURL,
                releaseDate: bid.releaseDate, targetTeamID: nil
            )
        } + counterpickBids.map { bid in
            Resolved(
                kind: .counterpick, movieKey: "counterpick:\(bid.movieID.rawValue)",
                entry: BidHistoryEntry(bidID: bid.id, teamID: bid.teamID, amount: bid.amount, reason: bid.resolutionReason),
                won: bid.status == .won, processingDeadline: bid.processingDeadline,
                title: bid.title, posterURL: bid.movie?.posterURL,
                releaseDate: bid.releaseDate, targetTeamID: bid.targetTeamID
            )
        }

        var order: [String] = []
        var byMovie: [String: [Resolved]] = [:]
        for bid in resolved {
            if byMovie[bid.movieKey] == nil { order.append(bid.movieKey) }
            byMovie[bid.movieKey, default: []].append(bid)
        }

        var results: [(result: BidHistoryResult, settledAt: Date)] = []
        for key in order {
            for contest in splitIntoContests(byMovie[key] ?? []) {
                results.append((toResult(contest), contest.settledAt))
            }
        }

        var dayOrder: [DateOnly] = []
        var byDay: [DateOnly: [(result: BidHistoryResult, settledAt: Date)]] = [:]
        for item in results {
            let day = DateOnly.today(now: item.settledAt)
            if byDay[day] == nil { dayOrder.append(day) }
            byDay[day, default: []].append(item)
        }

        return dayOrder.map { day in
            let sorted = (byDay[day] ?? []).enumerated().sorted { lhs, rhs in
                let a = headlineAmount(lhs.element.result), b = headlineAmount(rhs.element.result)
                return a != b ? a > b : lhs.offset < rhs.offset
            }
            return BidHistoryRound(date: day, results: sorted.map(\.element.result))
        }
        .sorted { $0.date > $1.date }
    }

    private static func splitIntoContests(_ bids: [Resolved]) -> [Contest] {
        let byDeadline = bids.enumerated().sorted { lhs, rhs in
            lhs.element.processingDeadline != rhs.element.processingDeadline
                ? lhs.element.processingDeadline < rhs.element.processingDeadline
                : lhs.offset < rhs.offset
        }.map(\.element)
        var contests: [Contest] = []
        for bid in byDeadline {
            let settledAt = bid.processingDeadline
            if var current = contests.last,
               settledAt.timeIntervalSince(current.settledAt) <= contestWindow,
               !(current.hasWinner && bid.won) {
                current.bids.append(bid)
                current.settledAt = max(current.settledAt, settledAt)
                current.hasWinner = current.hasWinner || bid.won
                contests[contests.count - 1] = current
            } else {
                contests.append(Contest(bids: [bid], settledAt: settledAt, hasWinner: bid.won))
            }
        }
        return contests
    }

    private static func toResult(_ contest: Contest) -> BidHistoryResult {
        let sample = contest.bids[0]
        let winner = contest.bids.first(where: \.won)?.entry
        let losers = contest.bids.filter { !$0.won }.map(\.entry).enumerated()
            .sorted { $0.element.amount != $1.element.amount ? $0.element.amount > $1.element.amount : $0.offset < $1.offset }
            .map(\.element)
        return BidHistoryResult(
            kind: sample.kind,
            id: "\(sample.movieKey)@\(contest.settledAt.timeIntervalSince1970)",
            title: sample.title,
            posterURL: sample.posterURL,
            releaseDate: sample.releaseDate,
            winner: winner,
            losers: losers,
            targetTeamID: sample.targetTeamID
        )
    }

    private static func headlineAmount(_ result: BidHistoryResult) -> Int {
        result.winner?.amount ?? result.losers.first?.amount ?? 0
    }
}
