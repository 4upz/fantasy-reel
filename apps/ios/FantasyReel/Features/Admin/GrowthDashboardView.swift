import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// The restricted growth dashboard (F-18): app administrators only, authorized
/// by `admin_growth_stats()` on the server. Pushed in the menu sheet's stack.
/// Read-only, and a vertical read of the web's `/admin` page: headline counts,
/// growth chart, funnels, monthly bars, gameplay, newest leagues and users.
///
/// When the server says this account isn't an administrator, the screen shows
/// "Not available" and nothing else.
struct GrowthDashboardView: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(SessionStore.self) private var session

    @State private var state: LoadState<GrowthStats> = .idle
    /// A failed pull-to-refresh while numbers are already on screen.
    @State private var refreshError: String?

    var body: some View {
        LoadStateView(
            state,
            loadingLabel: "Loading growth…",
            retry: { Task { await load() } }
        ) { stats in
            GrowthDashboardContent(stats: stats, refreshError: refreshError)
                .refreshable { await load() }
        } empty: {
            EmptyStateView(
                title: "Not available",
                message: "This page isn't available for your account.",
                systemImage: "lock"
            )
            .padding(.horizontal, FRMetrics.pageMargin)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.frBackground)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if state.value == nil, let userID = session.account?.id,
               let cached = AdminAccess.shared.cachedStats[userID] {
                state = .loaded(cached)
            }
            await load()
        }
    }

    private func load() async {
        guard let userID = session.account?.id else {
            state = .empty
            return
        }
        if state.value == nil { state = .loading }
        do {
            let stats = try await environment.admin.fetchGrowthStats()
            AdminAccess.shared.record(stats, for: userID)
            refreshError = nil
            if let stats {
                state = .loaded(stats)
            } else {
                // Not (or no longer) an administrator: drop anything shown.
                state = .empty
            }
        } catch {
            let message = APIError.wrap(error).userMessage
            if state.value != nil {
                refreshError = message
            } else {
                state = .failed(message: message)
            }
        }
    }
}

// MARK: - Content

private struct GrowthDashboardContent: View {
    let stats: GrowthStats
    let refreshError: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                header
                if let refreshError {
                    InlineBanner(tone: .warning, title: "Couldn't refresh", message: refreshError)
                }
                GrowthHeadlineGrid(stats: stats)

                SectionHeader("Growth over time")
                FRCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Running totals at the end of each week.")
                            .frFont(.bodySmall)
                            .foregroundStyle(Color.frTextSecondary)
                        GrowthLineChart(weeks: stats.growth)
                    }
                }

                SectionHeader("Where leagues stall")
                GrowthFunnelCard(
                    detail: "Each step counts leagues that reached it or went further, judged on their first season.",
                    shareOf: "leagues created",
                    steps: [
                        .init(label: "Created", value: stats.leagueFunnel.created),
                        .init(label: "Invited someone", value: stats.leagueFunnel.invited),
                        .init(label: "Got a second player", value: stats.leagueFunnel.secondPlayer),
                        .init(label: "Started a draft", value: stats.leagueFunnel.drafted),
                        .init(label: "Season underway", value: stats.leagueFunnel.live),
                    ]
                )

                SectionHeader("Where users stall")
                GrowthFunnelCard(
                    detail: "Based on the leagues each user is an active member of.",
                    shareOf: "users who signed up",
                    steps: [
                        .init(label: "Signed up", value: stats.users.total),
                        .init(label: "In a league", value: stats.userFunnel.inLeague),
                        .init(label: "In a league with others", value: stats.userFunnel.withOthers),
                        .init(label: "In a league that drafted", value: stats.userFunnel.drafted),
                    ]
                )

                GrowthMonthlyBars(title: "New users by month", months: stats.monthly, field: .signups)
                GrowthMonthlyBars(title: "New leagues by month", months: stats.monthly, field: .leagues)

                gameplay
                newestLeagues
                newestUsers
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            ScreenHeader("Growth")
            Text("Everyone who has signed up, and how far their leagues got.")
                .frFont(.body)
                .foregroundStyle(Color.frTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Text(verbatim: "As of \(GrowthFormat.generatedAt(stats.generatedAt)) UTC")
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
        }
    }

    // MARK: Gameplay

    private var gameplay: some View {
        let rows = stats.activity.rows
        return VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            SectionHeader("Gameplay")
            FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                ForEach(rows.indices, id: \.self) { index in
                    let label = rows[index].label
                    let period = rows[index].count
                    let recent = GrowthFormat.count(period.last30d)
                    let total = GrowthFormat.count(period.total)
                    ListRow(
                        title: label,
                        meta: "\(total) all time",
                        accessibilityLabel: "\(label), \(recent) in the last 30 days, \(total) all time"
                    ) {
                        TrailingValue(GrowthFormat.count(period.last30d), caption: "30 days", columnWidth: 80)
                    }
                }
            }
        }
    }

    // MARK: Newest leagues

    private var newestLeagues: some View {
        VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            SectionHeader("Newest leagues", detail: GrowthFormat.count(stats.leagueList.count))
            if stats.leagueList.isEmpty {
                emptyListCard("No leagues yet.")
            } else {
                GrowthLazyGroup(items: stats.leagueList) { league in
                    GrowthLeagueRow(league: league)
                }
            }
        }
    }

    // MARK: Newest users

    private var newestUsers: some View {
        VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            SectionHeader("Newest users", detail: GrowthFormat.count(stats.recentUsers.count))
            if stats.recentUsers.isEmpty {
                emptyListCard("No users yet.")
            } else {
                GrowthLazyGroup(items: stats.recentUsers) { user in
                    GrowthUserRow(user: user)
                }
            }
        }
    }

    private func emptyListCard(_ text: String) -> some View {
        FRCard {
            Text(text)
                .frFont(.bodySmall)
                .foregroundStyle(Color.frTextSecondary)
        }
    }
}

// MARK: - Headline

private struct GrowthHeadlineGrid: View {
    let stats: GrowthStats

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private struct Stat: Identifiable {
        let label: String
        let value: Int
        let note: String
        var id: String { label }
    }

    private var items: [Stat] {
        [
            Stat(
                label: "Users",
                value: stats.users.total,
                note: "+\(GrowthFormat.count(stats.users.new30d)) in the last 30 days"
            ),
            Stat(
                label: "Active in the last 30 days",
                value: stats.users.active30d,
                note: "\(GrowthFormat.count(stats.users.active7d)) in the last 7 days"
            ),
            Stat(
                label: "Leagues",
                value: stats.leagues.total,
                note: "+\(GrowthFormat.count(stats.leagues.new30d)) in the last 30 days"
            ),
            Stat(
                label: "Movies on rosters",
                value: stats.rosters.holdings,
                note: "\(GrowthFormat.count(stats.rosters.drafted)) drafted, \(GrowthFormat.count(stats.rosters.pickedUp)) picked up"
            ),
        ]
    }

    var body: some View {
        let cells = items
        if dynamicTypeSize.isAccessibilitySize {
            VStack(spacing: FRMetrics.sectionSpacing) {
                ForEach(cells) { cell($0) }
            }
        } else {
            Grid(horizontalSpacing: FRMetrics.sectionSpacing, verticalSpacing: FRMetrics.sectionSpacing) {
                GridRow {
                    cell(cells[0])
                    cell(cells[1])
                }
                GridRow {
                    cell(cells[2])
                    cell(cells[3])
                }
            }
        }
    }

    private func cell(_ stat: Stat) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(stat.label)
                .frFont(.label)
                .foregroundStyle(Color.frTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Text(GrowthFormat.count(stat.value))
                .frFont(.numberLarge)
                .foregroundStyle(Color.frText)
            Text(stat.note)
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(FRMetrics.cardPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .frCardBackground()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Funnel

private struct GrowthFunnelCard: View {
    struct Step: Identifiable {
        let label: String
        let value: Int
        var id: String { label }
    }

    let detail: String
    /// What each percentage is a share of: "40% of leagues created".
    let shareOf: String
    let steps: [Step]

    var body: some View {
        let start = steps.first?.value ?? 0
        FRCard {
            VStack(alignment: .leading, spacing: 14) {
                Text(detail)
                    .frFont(.bodySmall)
                    .foregroundStyle(Color.frTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(steps) { step in
                    stepRow(step, start: start)
                }
            }
        }
    }

    private func stepRow(_ step: Step, start: Int) -> some View {
        let share = start > 0 ? Double(step.value) / Double(start) : 0
        let percent = Int((share * 100).rounded())
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(step.label)
                    .frFont(.label)
                    .foregroundStyle(Color.frText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(GrowthFormat.count(step.value))
                    .frFont(.number)
                    .foregroundStyle(Color.frText)
                Text(verbatim: "\(percent)%")
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
                    .frame(minWidth: 40, alignment: .trailing)
            }
            GrowthShareBar(share: share, hasValue: step.value > 0)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(step.label), \(GrowthFormat.count(step.value)), \(percent)% of \(shareOf)")
    }
}

/// A proportional bar on the elevated track; decorative (the row says the
/// number and percentage in words).
private struct GrowthShareBar: View {
    let share: Double
    let hasValue: Bool

    var body: some View {
        Capsule()
            .fill(Color.frElevated)
            .frame(height: 8)
            .overlay(alignment: .leading) {
                GeometryReader { proxy in
                    let width = proxy.size.width * min(max(share, 0), 1)
                    Capsule()
                        .fill(Color.frGold)
                        .frame(width: hasValue ? max(width, 8) : 0, height: 8)
                }
            }
            .accessibilityHidden(true)
    }
}

// MARK: - Rows

/// A lazily built row group (`FRRowGroup` is eager; these lists run to 50).
private struct GrowthLazyGroup<Item: Identifiable, Row: View>: View {
    let items: [Item]
    @ViewBuilder let row: (Item) -> Row

    var body: some View {
        LazyVStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                row(item)
                    .overlay(alignment: .top) {
                        if index > 0 {
                            FRHairline().padding(.leading, FRMetrics.plainSeparatorInset)
                        }
                    }
            }
        }
        .background(Color.frSurface)
        .clipShape(RoundedRectangle(cornerRadius: FRMetrics.cardRadius, style: .continuous))
    }
}

private struct GrowthLeagueRow: View {
    let league: GrowthStats.LeagueRow

    private var owner: String { league.owner ?? "Unknown" }
    private var inviteSent: String { league.invited ? "Yes" : "No" }
    private var created: String { league.createdAt.formatted(date: .abbreviated, time: .omitted) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(league.name)
                    .frFont(.rowTitle)
                    .foregroundStyle(Color.frText)
                Text(verbatim: String(league.seasonYear))
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
            }
            Text(verbatim: "Owner: \(owner)")
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
            HStack(spacing: 8) {
                StatusBadge(status: league.status)
                Text(verbatim: "\(league.players) / \(league.maxPlayers) players")
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
            }
            Text(verbatim: "Invite sent: \(inviteSent) · Created \(created)")
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, FRMetrics.rowPadding)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: FRMetrics.rowHeight, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        let invited = league.invited ? "yes" : "no"
        return "\(league.name), \(league.seasonYear) season, owner \(owner), \(league.status.displayName), "
            + "\(league.players) of \(league.maxPlayers) players, invite sent \(invited), created \(created)"
    }
}

private struct GrowthUserRow: View {
    let user: GrowthStats.UserRow

    private var name: String { user.displayName ?? "No profile" }
    private var provider: String { GrowthFormat.providerLabel(user.provider) }
    private var signedUp: String { user.signedUpAt.formatted(date: .abbreviated, time: .omitted) }
    private var lastActive: String {
        user.lastActiveAt.map { $0.formatted(.relative(presentation: .named)) } ?? "Never"
    }
    private var leagues: String { user.leagues == 1 ? "1 league" : "\(user.leagues) leagues" }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(name)
                .frFont(.rowTitle)
                .foregroundStyle(Color.frText)
            Text(verbatim: "Signed in with \(provider) · \(leagues)")
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
            Text(verbatim: "Signed up \(signedUp) · Last active \(lastActive)")
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, FRMetrics.rowPadding)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: FRMetrics.rowHeight, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        "\(name), signed in with \(provider), \(leagues), signed up \(signedUp), last active \(lastActive)"
    }
}

// MARK: - Formatting

enum GrowthFormat {
    /// "1,234" in the user's locale.
    static func count(_ value: Int) -> String {
        value.formatted()
    }

    /// `generated_at` as the web prints it: medium date, short time, in UTC.
    static func generatedAt(_ date: Date) -> String {
        date.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened, timeZone: .gmt))
    }

    /// A UTC date bucket (`YYYY-MM-DD`) with the given fields, never shifted a day.
    static func bucket(_ date: DateOnly, _ style: Date.FormatStyle) -> String {
        date.date(in: .gmt).formatted(style)
    }

    /// A format style pinned to UTC, for `bucket(_:_:)` and chart axes.
    static var utc: Date.FormatStyle {
        Date.FormatStyle(timeZone: .gmt)
    }

    static func providerLabel(_ provider: String?) -> String {
        guard let provider else { return "Unknown" }
        switch provider {
        case "email": return "Email"
        case "google": return "Google"
        case "discord": return "Discord"
        case "apple": return "Apple"
        default: return provider
        }
    }
}

#if DEBUG
#Preview("Growth · not available") {
    let environment = AppEnvironment.preview()
    NavigationStack {
        GrowthDashboardView()
    }
    .environment(environment)
    .environment(environment.session)
}

#Preview("Growth · content") {
    if let stats = GrowthPreviewData.stats {
        GrowthDashboardContent(stats: stats, refreshError: nil)
            .background(Color.frBackground)
    } else {
        Text("Sample stats didn't decode.")
    }
}

private enum GrowthPreviewData {
    static var stats: GrowthStats? {
        try? FRJSON.decode(GrowthStats.self, from: Data(json.utf8))
    }

    private static let json = """
    {
      "generated_at": "2026-10-17T12:30:00Z",
      "users": { "total": 1234, "new_30d": 88, "active_7d": 140, "active_30d": 410 },
      "leagues": { "total": 210, "new_30d": 14 },
      "rosters": { "holdings": 3100, "drafted": 2600, "picked_up": 500 },
      "monthly": [
        { "month": "2025-11-01", "signups": 40, "leagues": 6 },
        { "month": "2025-12-01", "signups": 55, "leagues": 9 },
        { "month": "2026-01-01", "signups": 120, "leagues": 22 },
        { "month": "2026-02-01", "signups": 90, "leagues": 15 },
        { "month": "2026-03-01", "signups": 70, "leagues": 12 },
        { "month": "2026-04-01", "signups": 65, "leagues": 10 },
        { "month": "2026-05-01", "signups": 80, "leagues": 13 },
        { "month": "2026-06-01", "signups": 110, "leagues": 19 },
        { "month": "2026-07-01", "signups": 95, "leagues": 16 },
        { "month": "2026-08-01", "signups": 60, "leagues": 8 },
        { "month": "2026-09-01", "signups": 72, "leagues": 11 },
        { "month": "2026-10-01", "signups": 30, "leagues": 4 }
      ],
      "growth": [
        { "week": "2026-09-07", "users": 1050, "leagues": 180 },
        { "week": "2026-09-14", "users": 1100, "leagues": 188 },
        { "week": "2026-09-21", "users": 1150, "leagues": 196 },
        { "week": "2026-09-28", "users": 1190, "leagues": 203 },
        { "week": "2026-10-05", "users": 1234, "leagues": 210 }
      ],
      "league_funnel": { "created": 210, "invited": 160, "second_player": 130, "drafted": 95, "live": 80 },
      "user_funnel": { "in_league": 900, "with_others": 760, "drafted": 600 },
      "activity": {
        "draft_picks": { "total": 2600, "last_30d": 210 },
        "pickups": { "total": 500, "last_30d": 60 },
        "bids": { "total": 1400, "last_30d": 180 },
        "counterpicks": { "total": 190, "last_30d": 12 },
        "trades_proposed": { "total": 320, "last_30d": 40 },
        "trades_completed": { "total": 110, "last_30d": 9 }
      },
      "league_list": [
        { "id": "l1", "name": "Popcorn Syndicate", "owner": "Carol Coppola", "status": "active", "season_year": 2026,
          "players": 6, "max_players": 8, "invited": true, "created_at": "2026-10-01T09:00:00Z" },
        { "id": "l2", "name": "Office Movie Club", "owner": null, "status": "setup", "season_year": 2027,
          "players": 1, "max_players": 8, "invited": false, "created_at": "2026-10-12T09:00:00Z" }
      ],
      "recent_users": [
        { "id": "u1", "display_name": "Alice Spielberg", "provider": "google", "signed_up_at": "2026-10-15T09:00:00Z",
          "last_active_at": "2026-10-16T09:00:00Z", "leagues": 2 },
        { "id": "u2", "display_name": null, "provider": "email", "signed_up_at": "2026-10-16T09:00:00Z",
          "last_active_at": null, "leagues": 0 }
      ]
    }
    """
}
#endif
