import Foundation
import Testing
@testable import FantasyReelCore

struct DeepLinkTests {
    let hosts: Set<String> = ["fantasyreel.com", "www.fantasyreel.com"]
    let scheme = "fantasyreel"
    let leagueUUID = "6f1c2a7e-3b4d-4c5e-9f60-718293a4b5c6"

    func parse(_ string: String) -> DeepLink? {
        guard let url = URL(string: string) else { return nil }
        return DeepLink.parse(url, siteHosts: hosts, appScheme: scheme)
    }

    @Test func joinLinks() {
        #expect(parse("https://fantasyreel.com/join?code=ab12cd") == .joinCode("ab12cd"))
        #expect(parse("https://www.fantasyreel.com/join?token=0d6f7c1e-1111") == .invitation(token: "0d6f7c1e-1111"))
        // The web join page prefers the token when both are present.
        #expect(parse("https://fantasyreel.com/join?code=X&token=T") == .invitation(token: "T"))
        #expect(parse("https://fantasyreel.com/join") == nil)
        #expect(parse("https://fantasyreel.com/join?code=") == nil)
        #expect(parse("fantasyreel://join?code=ZZ") == .joinCode("ZZ"))
    }

    @Test func leagueLinks() {
        let id = LeagueID(leagueUUID)
        #expect(parse("https://fantasyreel.com/league/\(leagueUUID)") == .league(id, section: nil))
        #expect(parse("https://fantasyreel.com/league/\(leagueUUID)/") == .league(id, section: nil))
        #expect(parse("https://fantasyreel.com/league/\(leagueUUID)/dashboard") == .league(id, section: .overview))
        #expect(parse("https://fantasyreel.com/league/\(leagueUUID)/draft") == .league(id, section: .draft))
        #expect(parse("https://fantasyreel.com/league/\(leagueUUID)/roster") == .league(id, section: .roster))
        #expect(parse("https://fantasyreel.com/league/\(leagueUUID)/standings") == .league(id, section: .standings))
        #expect(parse("https://fantasyreel.com/league/\(leagueUUID)/bidding") == .league(id, section: .bidding))
        #expect(parse("https://fantasyreel.com/league/\(leagueUUID)/bidding/history") == .league(id, section: .bidding))
        #expect(parse("https://fantasyreel.com/league/\(leagueUUID)/trading") == .league(id, section: .trading))
        #expect(parse("https://fantasyreel.com/league/\(leagueUUID)/history") == .league(id, section: .history))
        #expect(parse("https://fantasyreel.com/league/\(leagueUUID)/settings") == .league(id, section: .settings))
        // An unknown page of a valid league still opens the league.
        #expect(parse("https://fantasyreel.com/league/\(leagueUUID)/mystery") == .league(id, section: nil))
        #expect(parse("fantasyreel://league/\(leagueUUID)/rules") == .league(id, section: .rules))
    }

    @Test func leagueIDsAreNormalized() {
        let upper = leagueUUID.uppercased()
        #expect(parse("https://fantasyreel.com/league/\(upper)/roster") == .league(LeagueID(leagueUUID), section: .roster))
    }

    @Test func legacyTabQueryWins() {
        let id = LeagueID(leagueUUID)
        #expect(parse("https://fantasyreel.com/league/\(leagueUUID)?tab=bidding") == .league(id, section: .bidding))
        #expect(parse("https://fantasyreel.com/league/\(leagueUUID)/roster?tab=bidding") == .league(id, section: .bidding))
        #expect(parse("https://fantasyreel.com/league/\(leagueUUID)/roster?tab=nonsense") == .league(id, section: .roster))
    }

    @Test func rejectsBadLeagueIDs() {
        #expect(parse("https://fantasyreel.com/league/not-a-uuid") == nil)
        #expect(parse("https://fantasyreel.com/league/123") == nil)
        #expect(parse("https://fantasyreel.com/league") == nil)
    }

    @Test func simplePages() {
        #expect(parse("https://www.fantasyreel.com/dashboard") == .home)
        #expect(parse("https://fantasyreel.com/movies") == .movies)
        #expect(parse("https://fantasyreel.com/wishlist") == .wishlist)
        #expect(parse("https://fantasyreel.com/settings") == .settings)
        #expect(parse("https://fantasyreel.com/help") == .help)
        #expect(parse("https://fantasyreel.com/how-to-play") == .help)
        #expect(parse("fantasyreel://notifications") == .notifications)
        #expect(parse("fantasyreel://movies") == .movies)
        #expect(parse("https://FantasyReel.com/Movies") == .movies)
    }

    @Test func authCallbackOnlyOnTheAppScheme() throws {
        let callback = try #require(URL(string: "fantasyreel://auth/callback?code=abc123"))
        #expect(DeepLink.parse(callback, siteHosts: hosts, appScheme: scheme) == .authCallback(callback))
        let fragment = try #require(URL(string: "fantasyreel://auth/callback#access_token=x&type=recovery"))
        #expect(DeepLink.parse(fragment, siteHosts: hosts, appScheme: scheme) == .authCallback(fragment))
        #expect(parse("https://fantasyreel.com/auth/callback?code=abc") == nil)
        #expect(parse("https://fantasyreel.com/auth/confirm?token_hash=abc") == nil)
        #expect(parse("fantasyreel://auth/somewhere") == nil)
    }

    @Test func rejectsEverythingElse() {
        #expect(parse("http://fantasyreel.com/movies") == nil)
        #expect(parse("https://evil.example/league/\(leagueUUID)") == nil)
        #expect(parse("https://fantasyreel.com.evil.example/movies") == nil)
        #expect(parse("https://fantasyreel.com:8443/movies") == nil)
        #expect(parse("https://user:pass@fantasyreel.com/movies") == nil)
        #expect(parse("https://fantasyreel.com/unsubscribe?token=abc") == nil)
        #expect(parse("https://fantasyreel.com/") == nil)
        #expect(parse("https://fantasyreel.com/privacy") == nil)
        #expect(parse("https://fantasyreel.com/movies/extra") == nil)
        #expect(parse("https://fantasyreel.com/dashboard/extra") == nil)
        #expect(parse("otherapp://movies") == nil)
        #expect(parse("mailto:alice@fantasyreel.test") == nil)
    }

    @Test func authRequirements() {
        #expect(!DeepLink.help.requiresAuthentication)
        #expect(DeepLink.movies.requiresAuthentication)
        #expect(DeepLink.home.requiresAuthentication)
        #expect(DeepLink.invitation(token: "t").requiresAuthentication)
    }

    @Test func sectionsMapToShellDestinations() {
        #expect(LeagueSection.bidding.tab == .bids)
        #expect(LeagueSection.overview.tab == .home)
        #expect(LeagueSection.history.tab == nil)
        #expect(LeagueSection.history.menuItem == .history)
        #expect(LeagueSection.rules.menuItem == .rules)
        #expect(LeagueSection.allCases.allSatisfy { ($0.tab == nil) != ($0.menuItem == nil) })
    }
}
