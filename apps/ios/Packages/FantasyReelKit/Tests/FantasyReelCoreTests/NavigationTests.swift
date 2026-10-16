import Testing
@testable import FantasyReelCore

struct LeagueNavigationTests {
    @Test func tabsPerStatus() {
        #expect(LeagueNavigation.tabs(for: .setup) == [.home, .draft, .roster])
        #expect(LeagueNavigation.tabs(for: .drafting) == [.home, .draft, .roster])
        #expect(LeagueNavigation.tabs(for: .counterpicking) == [.home, .draft, .roster])
        #expect(LeagueNavigation.tabs(for: .active) == [.home, .roster, .bids, .trades, .standings])
        #expect(LeagueNavigation.tabs(for: .completed) == [.home, .standings, .roster, .draft])
        #expect(LeagueNavigation.tabs(for: .unknown("paused")) == [.home, .roster])
    }

    @Test func defaultTabPerStatus() {
        #expect(LeagueNavigation.defaultTab(for: .setup) == .draft)
        #expect(LeagueNavigation.defaultTab(for: .drafting) == .draft)
        #expect(LeagueNavigation.defaultTab(for: .counterpicking) == .draft)
        #expect(LeagueNavigation.defaultTab(for: .active) == .home)
        #expect(LeagueNavigation.defaultTab(for: .completed) == .home)
        #expect(LeagueNavigation.defaultTab(for: .unknown("x")) == .home)
    }

    @Test func defaultTabIsAlwaysVisible() {
        for status in LeagueStatus.knownCases + [.unknown("x")] {
            #expect(LeagueNavigation.tabs(for: status).contains(LeagueNavigation.defaultTab(for: status)))
        }
    }

    @Test func resolvedTabFallsBackWhenHidden() {
        #expect(LeagueNavigation.resolvedTab(.bids, for: .active) == .bids)
        #expect(LeagueNavigation.resolvedTab(.bids, for: .completed) == .home)
        #expect(LeagueNavigation.resolvedTab(.standings, for: .drafting) == .draft)
        #expect(LeagueNavigation.resolvedTab(nil, for: .setup) == .draft)
        #expect(LeagueNavigation.resolvedTab(.draft, for: .completed) == .draft)
        #expect(LeagueNavigation.resolvedTab(.draft, for: .active) == .home)
    }

    @Test func menuForMembers() {
        #expect(LeagueNavigation.menuItems(status: .setup, isOwner: false, seasonCount: 1) == [.rules])
        #expect(LeagueNavigation.menuItems(status: .drafting, isOwner: false, seasonCount: 1) == [.rules])
        #expect(LeagueNavigation.menuItems(status: .counterpicking, isOwner: false, seasonCount: 2) == [.rules, .history])
        #expect(LeagueNavigation.menuItems(status: .active, isOwner: false, seasonCount: 1) == [.rules, .draftResults])
        #expect(LeagueNavigation.menuItems(status: .completed, isOwner: false, seasonCount: 3) == [.rules, .history])
        #expect(LeagueNavigation.menuItems(status: .unknown("x"), isOwner: false, seasonCount: 1) == [.rules])
    }

    @Test func menuForOwners() {
        #expect(LeagueNavigation.menuItems(status: .setup, isOwner: true, seasonCount: 1) == [.rules, .settings, .shareInvite])
        #expect(LeagueNavigation.menuItems(status: .setup, isOwner: true, seasonCount: 2) == [.rules, .history, .settings, .shareInvite])
        #expect(LeagueNavigation.menuItems(status: .drafting, isOwner: true, seasonCount: 1) == [.rules, .settings])
        #expect(LeagueNavigation.menuItems(status: .counterpicking, isOwner: true, seasonCount: 1) == [.rules, .settings])
        #expect(LeagueNavigation.menuItems(status: .active, isOwner: true, seasonCount: 1) == [.rules, .draftResults, .settings])
        #expect(LeagueNavigation.menuItems(status: .completed, isOwner: true, seasonCount: 2) == [.rules, .history, .settings])
        #expect(LeagueNavigation.menuItems(status: .unknown("x"), isOwner: true, seasonCount: 1) == [.rules, .settings])
    }

    @Test func titlesAndSymbols() {
        #expect(LeagueTab.allCases.map(\.title) == ["Home", "Draft", "Roster", "Bids", "Trades", "Standings"])
        #expect(LeagueTab.allCases.allSatisfy { !$0.systemImage.isEmpty })
        #expect(LeagueMenuItem.allCases.allSatisfy { !$0.title.isEmpty && !$0.systemImage.isEmpty })
    }
}
