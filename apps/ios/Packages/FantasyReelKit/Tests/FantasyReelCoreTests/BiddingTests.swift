import Foundation
import Testing
@testable import FantasyReelCore

/// Ports `scripts/tests/bid-fit-forecast.test.cjs`: the priority list's cut
/// line must agree with `process-bids` about which bids land.
struct BidFitForecastTests {
    private func forecast(
        _ targets: [String?],
        freeSlots: Int,
        remainingDrops: Int? = nil,
        droppable: Set<String> = ["h1", "h2"]
    ) -> [BidFunding?] {
        BidFitForecast.forecast(
            dropTargets: targets,
            freeSlots: freeSlots,
            remainingDrops: remainingDrops ?? targets.count,
            droppable: droppable
        )
    }

    @Test func twoBidsNamingTheSameTargetOnAFullRosterOnlyTheFirstLands() {
        #expect(forecast(["h1", "h1"], freeSlots: 0) == [.drop, nil])
    }

    @Test func distinctDropTargetsEachBringTheirOwnRoom() {
        #expect(forecast([nil, "h1", "h2", nil], freeSlots: 0) == [nil, .drop, .drop, nil])
    }

    @Test func aFreeSlotIsSpentBeforeAConditionalDrop() {
        #expect(forecast(["h1", nil], freeSlots: 1) == [.slot, nil])
        #expect(forecast(["h1", "h1"], freeSlots: 1, remainingDrops: 1) == [.slot, .drop])
    }

    @Test func onceSlotsRunOutADropCarrierStillLandsBelowPlainBids() {
        #expect(forecast([nil, nil, "h1"], freeSlots: 1) == [.slot, nil, .drop])
    }

    @Test func plainBidsFillFreeSlotsInPriorityOrder() {
        #expect(forecast([nil, nil, nil, nil], freeSlots: 2) == [.slot, .slot, nil, nil])
    }

    @Test func dropAllowanceIsSpentOnlyWhenADropSuppliesRoom() {
        #expect(forecast(["h1", "h2"], freeSlots: 0, remainingDrops: 0) == [nil, nil])
        #expect(forecast(["h1", "h2"], freeSlots: 0, remainingDrops: 1) == [.drop, nil])
        #expect(forecast(["h1", "h2"], freeSlots: 1, remainingDrops: 0) == [.slot, nil])
    }

    @Test func anIneligibleTargetCannotSupplyRoom() {
        #expect(forecast(["h1", "h2"], freeSlots: 0, remainingDrops: 1, droppable: ["h2"]) == [nil, .drop])
        #expect(forecast(["h1", "h2"], freeSlots: 1, remainingDrops: 1, droppable: ["h2"]) == [.slot, .drop])
    }

    @Test(arguments: [false, true])
    func droppableHoldingsFollowReleaseAndCounterpickRules(counterpicksBlockDrops: Bool) {
        func holding(_ id: String, movie: String, release: DateOnly?, counterpickedBy: TeamID? = nil) -> TeamHolding {
            TeamHolding(
                holdingID: HoldingID(id), source: .draft, leagueID: "league", teamID: "team",
                movieID: MovieID(movie), counterpickedByTeamID: counterpickedBy,
                teamName: "Team", tmdbID: 1, title: id, releaseDate: release
            )
        }
        let holdings = [
            holding("released", movie: "m1", release: DateOnly(year: 2026, month: 9, day: 26)),
            holding("today", movie: "m2", release: DateOnly(year: 2026, month: 9, day: 27)),
            holding("unknown-release", movie: "m3", release: nil),
            holding("counterpicked", movie: "m4", release: DateOnly(year: 2027, month: 1, day: 1), counterpickedBy: "other-team"),
            holding("contested", movie: "m5", release: DateOnly(year: 2027, month: 1, day: 1)),
        ]
        let ids = BidFitForecast.droppableHoldingIDs(
            holdings,
            today: DateOnly(year: 2026, month: 9, day: 27)!,
            counterpicksBlockDrops: counterpicksBlockDrops,
            contestedMovieIDs: ["m5"]
        ).map(\.rawValue)
        #expect(ids == (counterpicksBlockDrops
            ? ["today", "unknown-release"]
            : ["today", "unknown-release", "counterpicked", "contested"]))
    }
}

struct BidRuleTests {
    private let deadline = Date(timeIntervalSince1970: 1_800_000_000)

    @Test func theCounterPhaseStartsAtTheCutoffInclusive() {
        let cutoff = deadline.addingTimeInterval(-24 * 3600)
        let week = BidWeek(processingDeadline: deadline, cutoffAt: cutoff)
        #expect(!week.isCounterBidPhase(now: cutoff.addingTimeInterval(-1)))
        #expect(week.isCounterBidPhase(now: cutoff))
        #expect(!BidWeek(processingDeadline: deadline, cutoffAt: nil).isCounterBidPhase(now: deadline))
    }

    @Test func amountProblemsMatchTheWebSheet() {
        #expect(BidAmountRule.problem(amount: 5, remainingBudget: nil, highBid: nil) == "Your budget is unavailable. Close this and try again.")
        #expect(BidAmountRule.problem(amount: 60, remainingBudget: 50, highBid: nil) == "Exceeds your budget of $50")
        #expect(BidAmountRule.problem(amount: 101, remainingBudget: 200, highBid: nil) == "Maximum bid is $100")
        #expect(BidAmountRule.problem(amount: 8, remainingBudget: 50, highBid: 8) == "Must be higher than current bid of $8")
        #expect(BidAmountRule.problem(amount: 0, remainingBudget: 50, highBid: nil) == nil)
        #expect(BidAmountRule.initialAmount(highBid: 8) == 9)
        #expect(BidAmountRule.initialAmount(highBid: nil) == 0)
    }
}

struct BidTimingTests {
    @Test func theCounterCountdownDropsItsSuffixOnceTheWindowCloses() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        #expect(BidTiming.counterTimeLeft(until: now.addingTimeInterval(2 * 3600 + 5 * 60), now: now) == "2h 5m to counter")
        #expect(BidTiming.counterTimeLeft(until: now.addingTimeInterval(-60), now: now) == "Processing soon")
        #expect(BidTiming.counterTimeLeft(until: nil, now: now) == "Processing soon")
    }
}
