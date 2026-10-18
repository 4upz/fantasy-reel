import SwiftUI

/// How to Play (F-01), signed in (menu sheet) or out (from Welcome). The text
/// is the web's `HowToPlayContent`, so the rules read the same everywhere;
/// change both together. It shows no movie data, so it has no TMDb attribution.
struct HowToPlayView: View {
    /// Signed out: ends with Create Account and Log In.
    var isPublic = false

    private enum Topic: String, CaseIterable, Identifiable {
        case overview, leagues, drafting, scoring, pickups, trading, discord

        var id: Self { self }

        var label: String {
            switch self {
            case .overview: "Overview"
            case .leagues: "Leagues"
            case .drafting: "Drafting"
            case .scoring: "Scoring"
            case .pickups: "Pickups & drops"
            case .trading: "Trading"
            case .discord: "Discord bot"
            }
        }

        var systemImage: String {
            switch self {
            case .overview: "film"
            case .leagues: "person.3"
            case .drafting: "rectangle.stack"
            case .scoring: "trophy"
            case .pickups: "dollarsign.circle"
            case .trading: "arrow.left.arrow.right"
            case .discord: "bubble.left.and.bubble.right"
            }
        }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    VStack(alignment: .leading, spacing: 8) {
                        ScreenHeader("How to Play")
                        Paragraph("Draft upcoming movies, compete with friends, and earn points based on real critic reviews. The manager with the highest-scoring roster wins!")
                    }
                    jumpTo(proxy)
                    overview.id(Topic.overview)
                    leagues.id(Topic.leagues)
                    drafting.id(Topic.drafting)
                    scoring.id(Topic.scoring)
                    pickups.id(Topic.pickups)
                    trading.id(Topic.trading)
                    discord.id(Topic.discord)
                    if isPublic { readyToPlay }
                }
                .padding(.horizontal, FRMetrics.pageMargin)
                .padding(.bottom, 32)
            }
        }
        .background(Color.frBackground)
        .navigationTitle("How to Play")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(verbatim: "").accessibilityHidden(true)
            }
        }
    }

    private func jumpTo(_ proxy: ScrollViewProxy) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(Topic.allCases) { topic in
                    Button {
                        withAnimation { proxy.scrollTo(topic, anchor: .top) }
                    } label: {
                        Label(topic.label, systemImage: topic.systemImage)
                            .frFont(.label)
                            .foregroundStyle(Color.frText)
                            .padding(.horizontal, 14)
                            .frame(minHeight: 36)
                            .background(Color.frSurface, in: Capsule())
                            .frame(minHeight: FRMetrics.minTapTarget)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .scrollIndicators(.hidden)
        .scrollClipDisabled()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Jump to section")
    }

    // MARK: Sections

    private var overview: some View {
        GuideSection("What is Fantasy Reel?", systemImage: Topic.overview.systemImage) {
            Paragraph("Fantasy Reel works just like fantasy sports, but for films! Instead of drafting athletes, you draft upcoming movies. When those movies release and get reviewed by critics, you earn fantasy points based on their scores.")
            GuideCard(title: "The basic flow") {
                NumberedList([
                    "Join or create a league with friends",
                    "Draft movies you think will be critically acclaimed",
                    "Wait for your movies to release and get reviewed",
                    "Earn fantasy points based on the Rotten Tomatoes Tomatometer",
                    "The manager with the most points at the end wins!",
                ])
            }
        }
    }

    private var leagues: some View {
        GuideSection("Leagues", systemImage: Topic.leagues.systemImage) {
            Paragraph("A league is a group of managers (players) competing against each other over a movie season. Each league has its own draft, roster settings, and standings.")
            GuideCard(title: "Creating a league") {
                BulletList([
                    "Set a name and configure draft settings",
                    "Choose number of rounds (how many movies each team drafts)",
                    "Set a fantasy budget for pickups (optional)",
                    "Invite friends via email or share an invite link",
                ])
            }
            GuideCard(title: "Joining a league") {
                BulletList([
                    "Accept an email invitation",
                    "Or use a shared invite link",
                    "Create your team name",
                    "Wait for the league owner to start the draft",
                ])
            }
            Callout(title: "League status", text: "Leagues progress through stages: Setup, then Drafting, then Active, then Completed. Different features are available at each stage.")
        }
    }

    private var drafting: some View {
        GuideSection("Drafting", systemImage: Topic.drafting.systemImage) {
            Paragraph("The draft is where you build your roster by selecting movies before they release. Each movie can only be drafted by one team in the league.")
            GuideCard(title: "Snake draft format") {
                Paragraph("Most leagues use a “snake” draft, where the pick order reverses each round:", secondary: true)
                VStack(alignment: .leading, spacing: 4) {
                    SnakeRound(number: 1, teams: ["Team A", "Team B", "Team C", "Team D"])
                    SnakeRound(number: 2, teams: ["Team D", "Team C", "Team B", "Team A"])
                    SnakeRound(number: 3, teams: ["Team A", "Team B", "Team C", "Team D"])
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.frElevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                Paragraph("This ensures fairness: the team that picks last in round 1 picks first in round 2.", secondary: true)
            }
            GuideCard(title: "Draft strategy tips") {
                TipList([
                    ("Research directors and studios:", "Films from acclaimed directors or studios with strong track records tend to review better."),
                    ("Consider release timing:", "Movies releasing during awards season (Oct–Dec) often aim for critical acclaim."),
                    ("Balance risk:", "Big blockbusters might be safer picks, but indie films can be sleeper hits with high scores."),
                    ("Watch for delays:", "Movies can be delayed or moved, so check release dates carefully."),
                ])
            }
            GuideCard(title: "Counterpick rounds (optional)") {
                Paragraph("Some leagues enable counterpick rounds after the main draft. A counterpick is a bet against an opponent's movie: you score its points in reverse, so if it flops you gain what it loses, and if it's a hit, you lose what it earns.", secondary: true)
            }
        }
    }

    private var scoring: some View {
        GuideSection("Scoring system", systemImage: Topic.scoring.systemImage) {
            Paragraph("Fantasy points come from a single number: the Rotten Tomatoes Tomatometer. The baseline is 60%, RT's own “Fresh” line. Fresh movies earn points, rotten movies cost you points, and each league chooses whether points above 90% count double.")
            GuideCard(title: "How points are calculated") {
                VStack(alignment: .leading, spacing: 14) {
                    ScoringRule(tone: .success, systemImage: "chart.line.uptrend.xyaxis", title: "60%+ · Fresh", detail: "+1 point for each point above 60, all the way to 100%")
                    ScoringRule(tone: .gold, systemImage: "star.fill", title: "Above 90% · Double points (league option)", detail: "Leagues that turn on double points pay 2 points for each point above 90 instead of 1. The commissioner sets it for each season, and it locks once the draft is over.")
                    ScoringRule(tone: .error, systemImage: "chart.line.downtrend.xyaxis", title: "Below 60% · Rotten", detail: "−1 point for each point below 60. Below 50%, the losses taper off (each 10 points deeper costs half as much), bottoming out near −20 points.")
                }
            }
            Text("Example scores")
                .frFont(.rowTitle)
                .foregroundStyle(Color.frText)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, 4)
            VStack(spacing: 8) {
                ScoreExample(title: "The 90% Club", score: "RT 96%", lines: ["+36 (36 points above the 60% line)", "Default: every point counts once"], total: "+36 pts", isPositive: true)
                ScoreExample(title: "Double points above 90%", score: "RT 96%, in a league with double points on", lines: ["+30 (30 points above the 60% line, up to 90%)", "+12 (2 × 6 points above 90)"], total: "+42 pts", isPositive: true)
                ScoreExample(title: "Certified Crowd-Pleaser", score: "RT 84%", lines: ["+24 (24 points above the 60% line)"], total: "+24 pts", isPositive: true)
                ScoreExample(title: "Right at the Line", score: "RT 60%", lines: ["Exactly at the Fresh baseline"], total: "0 pts", isPositive: true)
                ScoreExample(title: "Rotten", score: "RT 35%", lines: ["−15 at 40%, tapering below", "Losses cap out near −20"], total: "−16 pts", isPositive: false)
                ScoreExample(title: "Counterpick on a hit", score: "RT 96%, counterpicked", lines: ["A counterpick loses whatever the movie earns", "−42 in a league with double points on"], total: "−36 pts", isPositive: false)
            }
            Callout(title: "Score source", text: "Points come from one number, the Rotten Tomatoes Tomatometer. 60% is break-even: above it a movie earns points, below it a movie loses them. Scores update nightly, even before release if critics review early, but a movie's points only count toward your total once it releases; until then its score shows as Pre-release. A movie without a Tomatometer yet shows as Pending.")
        }
    }

    private var pickups: some View {
        GuideSection("Pickups & drops", systemImage: Topic.pickups.systemImage) {
            Paragraph("After the draft, you can still acquire new movies through the pickup (waiver) system. Use your fantasy budget to bid on undrafted movies.")
            GuideCard(title: "Fantasy Budget bidding") {
                Paragraph("Your Fantasy Budget is your currency for pickups. Each league sets a budget amount (e.g., $100) that you can use throughout the season.", secondary: true)
                BulletList([
                    "Bid on available movies. If another team outbids you, you're told the new amount and get time to raise your bid",
                    "When bidding closes, the highest bid wins if that team has a roster slot and budget left. If not, the movie goes to the next eligible bidder at their own bid",
                    "Winning bid amount is deducted from your fantasy budget",
                    "Budget doesn't reset, so spend wisely!",
                    "Movies that already have a Tomatometer score can't be bid on or traded",
                ])
            }
            GuideCard(title: "Dropping movies") {
                Paragraph("You can drop movies from your roster to make room for pickups. Dropped movies become available for other teams to claim. Consider dropping movies that:", secondary: true)
                BulletList([
                    "Have been indefinitely delayed",
                    "Already released with poor scores",
                    "You need to free up roster space",
                ])
            }
        }
    }

    private var trading: some View {
        GuideSection("Trading", systemImage: Topic.trading.systemImage) {
            Paragraph("Trade movies with other managers to improve your roster. Both parties must agree for a trade to go through.")
            GuideCard(title: "Proposing a trade") {
                BulletList([
                    "Select movies from your roster to offer",
                    "Select movies you want in return",
                    "Send the proposal to the other manager",
                ])
            }
            GuideCard(title: "Responding to trades") {
                TipList([
                    ("Accept:", "Trade goes through after the league's review period, or within a few minutes if the league has none"),
                    ("Reject:", "Trade is cancelled"),
                    ("Counter:", "Modify and send back"),
                ], symbol: "arrow.right")
            }
            Callout(title: "League owner veto", text: "League owners can veto trades that appear unfair or collusive. Use this power responsibly!")
        }
    }

    private var discord: some View {
        GuideSection("Discord bot", systemImage: Topic.discord.systemImage) {
            Paragraph("Bring your league into your Discord server. The Fantasy Reel bot posts draft picks, bid results, trades, and score updates to the channel you choose, and answers commands like standings and rosters without leaving the chat.")
            DiscordBotGuide()
        }
    }

    private var readyToPlay: some View {
        VStack(spacing: 12) {
            Text("Ready to play?")
                .frFont(.pageTitle)
                .foregroundStyle(Color.frText)
                .accessibilityAddTraits(.isHeader)
            Paragraph("Create a league and invite your friends, or join an existing league to start drafting movies!", secondary: true)
                .multilineTextAlignment(.center)
            NavigationLink("Create Account", value: AuthRoute.signUp)
                .buttonStyle(.frPrimary)
                .padding(.top, 4)
            NavigationLink("Log In", value: AuthRoute.logIn)
                .buttonStyle(.frSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(FRMetrics.cardPadding)
        .background(Color.frSurface, in: RoundedRectangle(cornerRadius: FRMetrics.cardRadius, style: .continuous))
    }
}

// MARK: Building blocks

/// A topic: icon tile and heading, then its content.
private struct GuideSection<Content: View>: View {
    let title: String
    let systemImage: String
    let content: Content

    init(_ title: String, systemImage: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.systemImage = systemImage
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Color.frGold)
                    .frame(width: 36, height: 36)
                    .background(Color.frGoldTint, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .accessibilityHidden(true)
                Text(title)
                    .frFont(.sectionTitle)
                    .foregroundStyle(Color.frText)
                    .accessibilityAddTraits(.isHeader)
            }
            content
        }
    }
}

/// A titled card inside a section.
private struct GuideCard<Content: View>: View {
    let title: String
    let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .frFont(.rowTitle)
                .foregroundStyle(Color.frText)
                .accessibilityAddTraits(.isHeader)
            content
        }
        .padding(FRMetrics.rowPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.frSurface, in: RoundedRectangle(cornerRadius: FRMetrics.cardRadius, style: .continuous))
    }
}

private struct Paragraph: View {
    let text: String
    var secondary = false

    init(_ text: String, secondary: Bool = false) {
        self.text = text
        self.secondary = secondary
    }

    var body: some View {
        Text(text)
            .frFont(.body)
            .foregroundStyle(secondary ? Color.frTextSecondary : Color.frText)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// A gold-tinted note (`League status`, `Score source`, `League owner veto`).
private struct Callout: View {
    let title: String
    let text: String

    var body: some View {
        Text(Self.lead(title + ":", " " + text))
            .frFont(.body)
            .foregroundStyle(Color.frText)
            .fixedSize(horizontal: false, vertical: true)
            .padding(FRMetrics.rowPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.frGoldTint, in: RoundedRectangle(cornerRadius: FRMetrics.cardRadius, style: .continuous))
    }

    /// "Lead: text" with the lead in semibold, the web's `<strong>` lead-ins.
    static func lead(_ lead: String, _ text: String, leadColor: Color? = nil) -> AttributedString {
        var bold = AttributedString(lead)
        bold.inlinePresentationIntent = .stronglyEmphasized
        if let leadColor { bold.foregroundColor = leadColor }
        return bold + AttributedString(text)
    }
}

private struct NumberedList: View {
    let items: [String]

    init(_ items: [String]) { self.items = items }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(String(index + 1))
                        .font(FRFonts.fixedFont(.bricolage, weight: 700, size: 13, numeric: true))
                        .foregroundStyle(Color.frGold)
                        .frame(width: 24, height: 24)
                        .background(Color.frGoldTint, in: Circle())
                        .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 5 }
                    Text(item)
                        .frFont(.body)
                        .foregroundStyle(Color.frTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}

private struct BulletList: View {
    let items: [String]

    init(_ items: [String]) { self.items = items }

    var body: some View {
        TipList(items.map { ("", $0) }, symbol: "arrow.right")
    }
}

/// Lines with a leading symbol and an optional bold lead-in.
private struct TipList: View {
    let items: [(lead: String, text: String)]
    var symbol = "star.fill"

    init(_ items: [(String, String)], symbol: String = "star.fill") {
        self.items = items.map { (lead: $0.0, text: $0.1) }
        self.symbol = symbol
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Image(systemName: symbol)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.frGold)
                        .accessibilityHidden(true)
                    Text(item.lead.isEmpty ? AttributedString(item.text) : Callout.lead(item.lead, " " + item.text, leadColor: .frText))
                        .frFont(.body)
                        .foregroundStyle(Color.frTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

/// "Round 1: Team A → Team B → …", read as "then" by VoiceOver.
private struct SnakeRound: View {
    let number: Int
    let teams: [String]

    var body: some View {
        Text("Round \(number): \(teams.joined(separator: " → "))")
            .font(.system(.footnote, design: .monospaced))
            .foregroundStyle(Color.frText)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityLabel("Round \(number): \(teams.joined(separator: ", then "))")
    }
}

private struct ScoringRule: View {
    let tone: FRTone
    let systemImage: String
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(tone.foreground)
                .frame(width: 32, height: 32)
                .background(tone.background, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .frFont(.rowTitle)
                    .foregroundStyle(Color.frText)
                Text(detail)
                    .frFont(.bodySmall)
                    .foregroundStyle(Color.frTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// One worked example: accent bar (green for a gain, crimson for a loss),
/// title and total, then how the total is made.
private struct ScoreExample: View {
    let title: String
    let score: String
    let lines: [String]
    let total: String
    let isPositive: Bool

    var body: some View {
        HStack(spacing: 0) {
            Rectangle()
                .fill(isPositive ? Color.frSuccess : Color.frCrimson)
                .frame(width: 4)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(title)
                        .frFont(.rowTitle)
                        .foregroundStyle(Color.frText)
                    Spacer(minLength: 8)
                    Text(total)
                        .frFont(.number)
                        .foregroundStyle(isPositive ? Color.frSuccess : Color.frCrimsonText)
                }
                Text(score)
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
                ForEach(lines, id: \.self) { line in
                    Text(line)
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(14)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.frSurface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
