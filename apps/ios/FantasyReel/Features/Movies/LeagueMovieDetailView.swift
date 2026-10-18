import Charts
import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// A movie in the selected season (F-06, F-19; mockup V2MovieDetail): TMDb
/// details, our Rotten Tomatoes score and the points it's worth under this
/// season's rules, who holds it, the actions the season allows, a Beta
/// projection, franchise history and the cast. Outside a league it shows the
/// same research without the season parts.
struct LeagueMovieDetailView: View {
    let tmdbID: TMDbID

    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        MovieDetailScreen(
            model: LeagueMovieDetailModel(tmdbID: tmdbID, movies: environment.movies, leagueMovies: environment.leagueMovies)
        )
    }
}

private struct MovieDetailScreen: View {
    @State var model: LeagueMovieDetailModel

    @Environment(\.leagueSelection) private var tabSelection
    @Environment(LeagueDirectoryStore.self) private var directory
    @Environment(LeagueResearchStore.self) private var research
    @Environment(WishlistStore.self) private var wishlist

    /// The menu sheet has no league in its environment; fall back to the
    /// season the app is showing.
    private var selection: LeagueSelection? { tabSelection ?? directory.selection }

    var body: some View {
        LoadStateView(model.state, loadingLabel: "Loading movie…", emptyTitle: "Movie not found", retry: reload) { details in
            ScrollView {
                VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                    MovieHeader(details: details)
                    WishlistFailureBanner(tmdbIDs: [model.tmdbID])
                    if let error = model.leagueError {
                        InlineBanner(tone: .warning, title: "Some details are missing", message: error, actionTitle: "Retry", action: reload)
                    }
                    ScoreCard(
                        releaseDate: details.releaseDate,
                        movie: model.movie,
                        holding: model.holding,
                        season: selection?.season
                    )
                    if let selection {
                        OwnershipSection(selection: selection, holding: model.holding, myTeamID: myTeamID)
                        LeagueMovieActions(context: LeagueMovieContext(
                            selection: selection,
                            details: details,
                            holding: model.holding,
                            movie: model.movie,
                            myTeamID: myTeamID,
                            reload: { await model.load(league: selection.season) }
                        ))
                    }
                    // The server serves none once a released movie is scored.
                    if let projection = model.projection {
                        ProjectionCard(projection: projection)
                    }
                    FranchiseSection(
                        history: model.franchise,
                        error: model.franchiseError,
                        doublePointsOver90: selection?.season.doublePointsOver90 ?? false
                    )
                    AboutSection(details: details)
                    TMDbAttribution()
                }
                .padding(.horizontal, FRMetrics.pageMargin)
                .padding(.bottom, 24)
                .animation(.default, value: wishlist.failure)
            }
            .refreshable { await refresh() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    WishlistToggleButton(candidate: WishlistCandidate(details))
                }
            }
        }
        .background(Color.frBackground)
        .navigationTitle(model.state.value?.title ?? "Movie")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // The header draws the title; keep the bar free of a duplicate.
            ToolbarItem(placement: .principal) {
                Text(verbatim: "").accessibilityHidden(true)
            }
        }
        .task(id: selection?.season.id) { await refresh(force: false) }
    }

    private var myTeamID: TeamID? { research.holdings(in: selection?.season.id).myTeamID }

    private func reload() {
        Task { await refresh() }
    }

    private func refresh(force: Bool = true) async {
        async let modelLoaded: Void = model.load(league: selection?.season)
        if let selection { await research.load(selection, force: force) }
        if case .idle = wishlist.state { await wishlist.load() }
        await modelLoaded
    }
}

// MARK: - Header

private struct MovieHeader: View {
    let details: MovieDetails

    var body: some View {
        HStack(alignment: .bottom, spacing: 16) {
            PosterImage(posterURL: details.posterURL, title: details.title, size: CGSize(width: 96, height: 144), cornerRadius: 12)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(details.title)
                    .frFont(.pageTitle)
                    .foregroundStyle(Color.frText)
                    .accessibilityAddTraits(.isHeader)
                    .fixedSize(horizontal: false, vertical: true)
                if let facts = facts {
                    Text(facts)
                        .frFont(.label)
                        .foregroundStyle(Color.frTextSecondary)
                        .accessibilityLabel(spokenFacts ?? facts)
                }
                if !details.genres.isEmpty {
                    Text(details.genres.prefix(3).map(\.name).joined(separator: " · "))
                        .frFont(.label)
                        .foregroundStyle(Color.frTextSecondary)
                }
                Label(MovieFacts.releaseLine(details.releaseDate), systemImage: "calendar")
                    .frFont(.label)
                    .foregroundStyle(Color.frTextSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.top, 8)
    }

    private var facts: String? {
        let parts = [MovieFacts.year(details.releaseDate), MovieFacts.runtime(details.runtime)].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var spokenFacts: String? {
        let parts = [MovieFacts.year(details.releaseDate), MovieFacts.spokenRuntime(details.runtime)].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }
}

// MARK: - Score

/// The Tomatometer of record and what it's worth here. A holding's points
/// already follow the season's rule; a raw `movies` row gets the rule applied.
private struct ScoreCard: View {
    let releaseDate: DateOnly?
    let movie: Movie?
    let holding: TeamHolding?
    let season: League?

    private var rtScore: Double? { holding?.combinedScore ?? movie?.combinedScore }

    private var points: Double? {
        if let holding { return holding.fantasyPoints }
        guard let points = movie?.fantasyPoints else { return nil }
        return FantasyPoints.leagueFantasyPoints(
            points: points, rtScore: movie?.combinedScore, doublePointsOver90: season?.doublePointsOver90 ?? false
        )
    }

    private var preRelease: Bool { FantasyPoints.isPreReleaseScore(points: points, releaseDate: releaseDate) }

    var body: some View {
        FRCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Rotten Tomatoes")
                        .frFont(.label)
                        .foregroundStyle(Color.frTextSecondary)
                    Spacer()
                    if preRelease {
                        FRBadge("Pre-release", tone: .info)
                    } else if points == nil {
                        FRBadge("Pending", tone: .neutral)
                    }
                }
                HStack(alignment: .firstTextBaseline) {
                    Text(rtScore.map { FranchiseText.tomatometer($0) } ?? "--")
                        .frFont(.numberHero)
                        .foregroundStyle(preRelease ? Color.frTextSecondary : Color.frText)
                        .accessibilityLabel(rtScore.map { "Tomatometer \(FranchiseText.tomatometer($0))" } ?? "No Tomatometer yet")
                    Spacer()
                    PointsTrail(points: points, preRelease: preRelease, caption: preRelease ? "at release" : "points", valueRole: .numberLarge, columnWidth: nil)
                }
                FRHairline()
                Text(note)
                    .frFont(.bodySmall)
                    .foregroundStyle(Color.frTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var note: String {
        if preRelease {
            let date = releaseDate.map { $0.formatted(.full) } ?? "release day"
            return "Points count from release day, \(date). Until then the score can still move, and so can the points."
        }
        if points == nil {
            return "No Rotten Tomatoes score yet. Points arrive with the first score: every point above 60% earns one, below 60% costs."
        }
        if season?.doublePointsOver90 == true, (rtScore ?? 0) > 90 {
            return "This season pays double for every point above 90%, included here. Scored movies can't be bid on or traded."
        }
        return season == nil
            ? "Points are the Tomatometer minus 60, with smaller penalties further below 60%."
            : "Scored movies can't be bid on or traded."
    }
}

// MARK: - Ownership

private struct OwnershipSection: View {
    let selection: LeagueSelection
    let holding: TeamHolding?
    let myTeamID: TeamID?

    var body: some View {
        SectionHeader("In \(selection.season.name)")
        FRRowGroup {
            if let holding {
                LeagueLink(route: .team(holding.teamID)) {
                    ListRow(title: holding.teamName, meta: holderMeta(holding), showsChevron: true) {
                        Avatar(name: holding.teamName, size: .medium)
                    } trailing: {
                        EmptyView()
                    }
                }
                .buttonStyle(.frRow)
                ListRow(title: counterpickTitle(holding), meta: counterpickMeta(holding)) {
                    IconTile(systemImage: "arrow.left.arrow.right")
                } trailing: {
                    EmptyView()
                }
            } else {
                ListRow(title: "Available", meta: availableMeta) {
                    IconTile(systemImage: "checkmark.circle", tint: .frSuccess)
                } trailing: {
                    EmptyView()
                }
            }
        }
    }

    private func holderMeta(_ holding: TeamHolding) -> String {
        var parts: [String] = []
        if holding.teamID == myTeamID { parts.append("Your team") }
        switch holding.source {
        case .pickup:
            parts.append(holding.amountPaid.map { "Picked up for $\($0)" } ?? "Picked up")
        default:
            parts.append(holding.round.map { "Drafted round \($0)" } ?? "Drafted")
        }
        return parts.joined(separator: " · ")
    }

    private func counterpickTitle(_ holding: TeamHolding) -> String {
        holding.counterpickedByName.map { "Counterpicked by \($0)" } ?? "No counterpick"
    }

    private func counterpickMeta(_ holding: TeamHolding) -> String {
        holding.isCounterpicked ? "They score the inverse of this movie's points" : "Nobody has counterpicked it"
    }

    private var availableMeta: String {
        switch selection.season.status {
        case .setup, .drafting, .counterpicking: "Not drafted yet"
        case .completed: "Nobody held it at season's end"
        default: "No team holds it this season"
        }
    }
}

/// A 36pt rounded tile with a symbol, in the poster column of a row.
private struct IconTile: View {
    let systemImage: String
    var tint: Color = .frTextSecondary

    var body: some View {
        Image(systemName: systemImage)
            .font(.body.weight(.semibold))
            .foregroundStyle(tint)
            .frame(width: 36, height: 36)
            .background(Color.frElevated, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .accessibilityHidden(true)
    }
}

// MARK: - Projection (Beta, F-19)

private struct ProjectionCard: View {
    let projection: MovieProjection

    private var state: ProjectionText.ChipState { ProjectionText.chipState(projection) }

    private var toneColor: Color {
        switch ProjectionText.tone(projection, state: state) {
        case .fresh: .frGold
        case .rotten: .frCrimsonText
        case .uncertain: .frTextSecondary
        }
    }

    var body: some View {
        FRCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 8) {
                    Text("Projected Tomatometer")
                        .frFont(.cardTitle)
                        .foregroundStyle(Color.frText)
                        .accessibilityAddTraits(.isHeader)
                    BetaBadge()
                }
                headline
                if state != .insufficient {
                    ProjectionBar(projection: projection)
                    factors
                    stats
                }
                FRHairline()
                VStack(alignment: .leading, spacing: 6) {
                    if state != .insufficient {
                        Text(ProjectionText.rangeExplainer)
                    }
                    Text(ProjectionText.disclaimer)
                }
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .overlay {
            RoundedRectangle(cornerRadius: FRMetrics.cardRadius, style: .continuous)
                .strokeBorder(Color.frGold.opacity(0.45), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                .accessibilityHidden(true)
        }
    }

    private var headline: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(state == .insufficient ? ProjectionText.chipLabel(state) : ProjectionText.headline(state, projection: projection))
                    .frFont(state == .insufficient ? .sectionTitle : .numberHero)
                    .foregroundStyle(toneColor)
                Text(subhead)
                    .frFont(.label)
                    .foregroundStyle(Color.frTextSecondary)
            }
            if let updated = projection.computedAt {
                Text("Updated \(updated.formatted(.dateTime.month(.abbreviated).day()))")
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(ProjectionText.chipSpokenLabel(state)). \(subhead)")
    }

    private var subhead: String {
        switch state {
        case .early(_, let reviews): "Early reviews · \(reviews) so far"
        case .insufficient: "Too few related films to project"
        case .point(_, true): "Loose estimate"
        default: "Middle half of outcomes"
        }
    }

    private var factors: some View {
        VStack(spacing: 8) {
            FactorRow(label: "Genre baseline", value: "\(Int(projection.baselineRT.rounded()))", color: .frTextSecondary, tint: .frTextMuted)
            ForEach(ProjectionText.factors(projection)) { factor in
                let positive = factor.delta >= 0
                FactorRow(
                    label: factor.label,
                    value: FantasyPoints.signed(factor.delta.rounded()),
                    color: positive ? .frGold : .frCrimsonText,
                    tint: positive ? .frGold : .frCrimson
                )
            }
        }
    }

    private var stats: some View {
        let range = projection.range80Bounds
        let expected = ProjectionText.projectedPoints(projection)
        return VStack(alignment: .leading, spacing: 8) {
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 12) {
                GridRow {
                    Stat(label: "80% range", value: "\(Int(range.low.rounded()))–\(Int(range.high.rounded()))%")
                    Stat(label: "Chance rotten", value: ProjectionText.chance(projection.pRotten))
                }
                GridRow {
                    Stat(label: "Chance of 90%+", value: ProjectionText.chance(projection.p90))
                    Stat(
                        label: "Expected points",
                        value: "\(FantasyPoints.signed(expected.rounded())) pts",
                        color: expected >= 0 ? .frGold : .frCrimsonText
                    )
                }
            }
            if projection.includesEarlyReviews {
                Text("Includes early reviews.")
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
            }
        }
    }
}

private struct FactorRow: View {
    let label: String
    let value: String
    let color: Color
    let tint: Color

    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 2)
                .fill(tint)
                .frame(width: 10, height: 10)
                .accessibilityHidden(true)
            Text(label)
                .frFont(.bodySmall)
                .foregroundStyle(Color.frText)
            Spacer()
            Text(value)
                .frFont(.numberSmall)
                .foregroundStyle(color)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct Stat: View {
    let label: String
    let value: String
    var color: Color = .frText

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
            Text(value)
                .frFont(.number)
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// The stacked 0–100 bar: the genre baseline, then each factor stepping the
/// total up (gold) or down (crimson), with the 60% break-even marked.
private struct ProjectionBar: View {
    let projection: MovieProjection

    var body: some View {
        let segments = ProjectionText.barSegments(baseline: projection.baselineRT, factors: ProjectionText.factors(projection))
        VStack(spacing: 4) {
            GeometryReader { proxy in
                let width = proxy.size.width
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.frElevated)
                    ForEach(segments) { segment in
                        Rectangle()
                            .fill(segment.key == "baseline" ? Color.frTextMuted : (segment.positive ? Color.frGold : Color.frCrimson))
                            .frame(width: width * segment.width / 100)
                            .offset(x: width * segment.start / 100)
                    }
                    Rectangle()
                        .fill(Color.frText.opacity(0.8))
                        .frame(width: 1.5)
                        .offset(x: width * ProjectionText.breakEven / 100)
                }
                .clipShape(Capsule())
            }
            .frame(height: 12)
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Text(verbatim: "0")
                    Text(verbatim: "60")
                        .offset(x: proxy.size.width * 0.6 - 8)
                    Text(verbatim: "100")
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
            .frame(height: 16)
            .frFont(.caption)
            .foregroundStyle(Color.frTextSecondary)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Franchise history

private struct FranchiseSection: View {
    let history: FranchiseHistory?
    let error: String?
    let doublePointsOver90: Bool

    var body: some View {
        if let history, !history.films.isEmpty {
            SectionHeader("Franchise history", detail: FranchiseText.entryLabel(history))
            if history.scoredFilms.count >= 2 {
                FRCard {
                    VStack(alignment: .leading, spacing: 12) {
                        FranchiseChart(films: history.scoredFilms)
                        Text(FranchiseText.summary(history, doublePointsOver90: doublePointsOver90))
                            .frFont(.bodySmall)
                            .foregroundStyle(Color.frTextSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            } else {
                Text(FranchiseText.summary(history, doublePointsOver90: doublePointsOver90))
                    .frFont(.bodySmall)
                    .foregroundStyle(Color.frTextSecondary)
                    .padding(.horizontal, 4)
                    .fixedSize(horizontal: false, vertical: true)
            }
            FRRowGroup {
                ForEach(history.films.reversed()) { film in
                    LeagueLink(route: .movie(film.tmdbID)) {
                        MovieRow(
                            title: film.title,
                            meta: [MovieFacts.year(film.releaseDate), "Earlier film in the series"].compactMap { $0 }.joined(separator: " · "),
                            posterURL: film.posterURL,
                            accessibilityLabel: "\(film.title), \(MovieFacts.year(film.releaseDate) ?? "earlier film"), Tomatometer \(FranchiseText.tomatometer(film.rtScore))"
                        ) {
                            Text("RT \(FranchiseText.tomatometer(film.rtScore))")
                                .frFont(.numberSmall)
                                .foregroundStyle(scoreColor(film.rtScore))
                        }
                    }
                    .buttonStyle(.frRow)
                }
            }
        } else if let error {
            InlineBanner(tone: .warning, title: "Franchise history unavailable", message: error)
        }
    }

    private func scoreColor(_ score: Double?) -> Color {
        guard let score else { return .frTextSecondary }
        return score >= FranchiseText.breakEven ? .frText : .frCrimsonText
    }
}

/// Prior films' Tomatometers in release order against the 60% break-even.
/// The rows below carry the same numbers for VoiceOver.
private struct FranchiseChart: View {
    let films: [FranchiseFilm]

    var body: some View {
        Chart {
            RuleMark(y: .value("Break-even", FranchiseText.breakEven))
                .foregroundStyle(Color.frTextSecondary)
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                .annotation(position: .top, alignment: .leading) {
                    Text("60% break-even")
                        .frFont(.caption)
                        .foregroundStyle(Color.frTextSecondary)
                }
            ForEach(Array(films.enumerated()), id: \.element.id) { index, film in
                LineMark(x: .value("Film", index + 1), y: .value("Tomatometer", film.rtScore ?? 0))
                    .foregroundStyle(Color.frGold)
                PointMark(x: .value("Film", index + 1), y: .value("Tomatometer", film.rtScore ?? 0))
                    .foregroundStyle((film.rtScore ?? 0) >= FranchiseText.breakEven ? Color.frGold : Color.frCrimson)
            }
        }
        .chartYScale(domain: 0...100)
        .chartXScale(domain: 0.5...(Double(films.count) + 0.5))
        .chartXAxis(.hidden)
        .chartYAxis {
            AxisMarks(values: [0, 50, 100]) { value in
                AxisGridLine().foregroundStyle(Color.frSeparator)
                AxisValueLabel {
                    if let number = value.as(Int.self) { Text("\(number)%").frFont(.caption) }
                }
            }
        }
        .frame(height: 140)
        .accessibilityHidden(true)
    }
}

// MARK: - About

private struct AboutSection: View {
    let details: MovieDetails

    var body: some View {
        if hasOverview {
            SectionHeader("Overview")
            VStack(alignment: .leading, spacing: 8) {
                if let tagline = details.tagline, !tagline.isEmpty {
                    Text(tagline)
                        .frFont(.body)
                        .italic()
                        .foregroundStyle(Color.frText)
                }
                if let overview = details.overview, !overview.isEmpty {
                    Text(overview)
                        .frFont(.body)
                        .foregroundStyle(Color.frTextSecondary)
                }
                if let director = details.director {
                    Text("Directed by \(director)")
                        .frFont(.label)
                        .foregroundStyle(Color.frText)
                }
            }
            .padding(.horizontal, 4)
            .fixedSize(horizontal: false, vertical: true)
        }
        if !details.cast.isEmpty {
            SectionHeader("Cast")
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 12) {
                    ForEach(details.cast.prefix(12)) { member in
                        VStack(spacing: 6) {
                            Avatar(
                                name: member.name,
                                imageURL: TMDbImage.posterURL(member.profileURL, size: .w185)?.absoluteString,
                                size: .extraLarge
                            )
                            Text(member.name)
                                .frFont(.meta)
                                .foregroundStyle(Color.frText)
                            if let character = member.character, !character.isEmpty {
                                Text(character)
                                    .frFont(.caption)
                                    .foregroundStyle(Color.frTextSecondary)
                            }
                        }
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                        .frame(width: 84)
                        .accessibilityElement(children: .combine)
                    }
                }
                .padding(.horizontal, FRMetrics.pageMargin)
            }
            .scrollIndicators(.hidden)
            .padding(.horizontal, -FRMetrics.pageMargin)
        }
        if let imdb = details.imdbURL {
            FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                Link(destination: imdb) {
                    HStack {
                        Text("View on IMDb")
                            .frFont(.rowLabel)
                            .foregroundStyle(Color.frGold)
                        Spacer()
                        Image(systemName: "arrow.up.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Color.frTextMuted)
                            .accessibilityHidden(true)
                    }
                    .padding(.horizontal, FRMetrics.rowPadding)
                    .frame(minHeight: 48)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.frRow)
            }
            .padding(.top, FRMetrics.sectionSpacing)
        }
    }

    private var hasOverview: Bool {
        !(details.overview ?? "").isEmpty || !(details.tagline ?? "").isEmpty || details.director != nil
    }
}
