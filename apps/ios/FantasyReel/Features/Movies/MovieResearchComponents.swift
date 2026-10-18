import FantasyReelAPI
import FantasyReelCore
import SwiftUI

// Pieces shared by search, movie detail, the wishlist and other features'
// movie pickers (bids, the draft board).

extension EnvironmentValues {
    /// True inside the menu sheet, whose stack holds `MenuRoute`s: league
    /// screens pushed there go through `MenuRoute.league`.
    @Entry var routesThroughMenu = false
}

/// A link to a league screen (a movie, a team) that works on a league tab's
/// stack and inside the menu sheet's stack alike.
struct LeagueLink<Label: View>: View {
    let route: LeagueRoute
    @ViewBuilder let label: () -> Label

    @Environment(\.routesThroughMenu) private var routesThroughMenu

    var body: some View {
        if routesThroughMenu {
            NavigationLink(value: MenuRoute.league(route), label: label)
        } else {
            NavigationLink(value: route, label: label)
        }
    }
}

/// The bookmark that adds a movie to, or removes it from, the person's
/// wishlist. Reads the shared `WishlistStore`, so every bookmark for the same
/// movie flips together.
struct WishlistToggleButton: View {
    enum Style {
        /// A bare 44pt icon (row trailing column, toolbar).
        case icon
        /// A small glass circle over a poster (carousels).
        case overlay
        /// A toolbar item: the bar draws the glass.
        case toolbar
    }

    let candidate: WishlistCandidate
    var style: Style = .icon

    @Environment(WishlistStore.self) private var wishlist

    var body: some View {
        // The toolbar keeps the system style so the bar's glass applies.
        if style == .toolbar {
            button
        } else {
            button.buttonStyle(.plain)
        }
    }

    private var button: some View {
        let saved = wishlist.contains(candidate.tmdbID)
        return Button {
            Task { await wishlist.toggle(candidate) }
        } label: {
            switch style {
            case .icon:
                Image(systemName: saved ? "bookmark.fill" : "bookmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(saved ? Color.frGold : Color.frTextSecondary)
                    .frame(width: FRMetrics.minTapTarget, height: FRMetrics.minTapTarget)
                    .contentShape(Rectangle())
            case .toolbar:
                Label(saved ? "Saved" : "Save", systemImage: saved ? "bookmark.fill" : "bookmark")
                    .foregroundStyle(saved ? Color.frGold : Color.frText)
            case .overlay:
                Image(systemName: saved ? "bookmark.fill" : "bookmark")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(saved ? Color.frGold : Color.white)
                    .frame(width: 30, height: 30)
                    .background(.black.opacity(0.55), in: Circle())
                    .frame(width: FRMetrics.minTapTarget, height: FRMetrics.minTapTarget)
                    .contentShape(Rectangle())
            }
        }
        // Until the list has loaded, a saved movie would read as unsaved.
        .disabled(wishlist.isSaving(candidate.tmdbID) || wishlist.state.value == nil)
        .accessibilityLabel(saved ? "Remove \(candidate.title) from wishlist" : "Add \(candidate.title) to wishlist")
        .accessibilityAddTraits(saved ? .isSelected : [])
        .sensoryFeedback(.selection, trigger: saved)
    }
}

/// A wishlist failure for one of the movies on screen, shown inline above
/// the content until dismissed or the next toggle.
struct WishlistFailureBanner: View {
    /// Only failures for these movies; nil shows any.
    var tmdbIDs: Set<TMDbID>?

    @Environment(WishlistStore.self) private var wishlist

    var body: some View {
        if let failure = wishlist.failure, tmdbIDs?.contains(failure.tmdbID) ?? true {
            InlineBanner(tone: .error, title: "Wishlist not updated", message: failure.message, actionTitle: "OK") {
                wishlist.clearFailure()
            }
            .transition(.opacity)
        }
    }
}

extension LeagueMovieStatus {
    var color: Color {
        switch self {
        case .available: .frSuccess
        case .yours: .frGold
        case .heldBy: .frTextSecondary
        }
    }
}

extension WishlistCandidate {
    init(_ result: MovieSearchResult) {
        self.init(tmdbID: result.tmdbID, title: result.title, posterURL: result.posterURL)
    }

    init(_ movie: WishlistedMovie) {
        self.init(tmdbID: movie.tmdbID, title: movie.title, posterURL: movie.posterURL)
    }

    init(_ details: MovieDetails) {
        self.init(tmdbID: details.tmdbID, title: details.title, posterURL: details.posterURL)
    }
}

/// The meta line under a movie title: "Oct 9 · Drafted by Reel Deal", with
/// the season status in its color (the words carry the meaning too).
struct MovieMetaText: View {
    let detail: String?
    let status: LeagueMovieStatus?

    var body: some View {
        Text(attributed)
    }

    private var attributed: AttributedString {
        var parts: [AttributedString] = []
        if let detail { parts.append(AttributedString(detail)) }
        if let status {
            var label = AttributedString(status.label)
            label.swiftUI.foregroundColor = status.color
            parts.append(label)
        }
        guard var result = parts.first else { return AttributedString("") }
        for part in parts.dropFirst() {
            result += AttributedString(" · ")
            result += part
        }
        return result
    }

    static func plain(detail: String?, status: LeagueMovieStatus?) -> String {
        [detail, status?.label].compactMap { $0 }.joined(separator: " · ")
    }

    /// "Oct 9" this year; "Jun 30, 2027" in any other year; nil when unknown.
    static func shortDate(_ date: DateOnly?, now: Date = Date()) -> String? {
        guard let date else { return nil }
        let utcZone = TimeZone(identifier: "UTC")!
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utcZone
        guard let day = calendar.date(from: DateComponents(year: date.year, month: date.month, day: date.day)) else { return nil }
        var style = Date.FormatStyle(timeZone: utcZone).month(.abbreviated).day()
        if date.year != calendar.component(.year, from: now) { style = style.year() }
        return day.formatted(style)
    }

    /// The release part of a search result's meta line.
    static func release(_ date: DateOnly?) -> String {
        shortDate(date) ?? "Date not announced"
    }
}

/// A movie row for research lists (the `.mrow` layout with a colored status
/// in the meta line): poster, title, a detail and the league status, and the
/// wishlist bookmark. The row opens the movie; the bookmark is its own control
/// beside it.
struct ResearchMovieRow: View {
    let title: String
    let posterURL: String?
    /// The first part of the meta line (release date, "Added 3d ago").
    let detail: String?
    /// `detail` as VoiceOver should say it, when different.
    var spokenDetail: String?
    let status: LeagueMovieStatus?
    let candidate: WishlistCandidate
    var showsBookmark = true

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        HStack(spacing: 0) {
            LeagueLink(route: .movie(candidate.tmdbID)) {
                HStack(spacing: FRMetrics.rowGap) {
                    PosterImage(posterURL: posterURL, title: title)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title)
                            .frFont(.rowTitle)
                            .foregroundStyle(Color.frText)
                            .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
                        MovieMetaText(detail: detail, status: status)
                            .frFont(.meta)
                            .foregroundStyle(Color.frTextSecondary)
                            .lineLimit(dynamicTypeSize.isAccessibilitySize ? 4 : 1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if !showsBookmark {
                        RowChevron()
                    }
                }
                .padding(.leading, FRMetrics.rowPadding)
                .padding(.trailing, showsBookmark ? 4 : FRMetrics.rowPadding)
                .padding(.vertical, 8)
                .frame(minHeight: FRMetrics.rowHeight)
                .contentShape(Rectangle())
                .accessibilityElement(children: .ignore)
                .accessibilityLabel([title, MovieMetaText.plain(detail: spokenDetail ?? detail, status: status)]
                    .filter { !$0.isEmpty }
                    .joined(separator: ", "))
            }
            .buttonStyle(.frRow)
            if showsBookmark {
                WishlistToggleButton(candidate: candidate)
                    .padding(.trailing, 6)
            }
        }
    }
}

/// Rows on one rounded surface with inset hairlines, built lazily: the
/// `FRRowGroup` look for long lists (search results, wishlists).
struct LazyRowGroup<Item: Identifiable, Row: View>: View {
    let items: [Item]
    var separatorInset: CGFloat = FRMetrics.separatorInset
    @ViewBuilder let row: (Item) -> Row

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        LazyVStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                row(item)
                    .overlay(alignment: .top) {
                        if index > 0 {
                            Rectangle()
                                .fill(Color.frSeparator)
                                .frame(height: 1 / displayScale)
                                .padding(.leading, separatorInset)
                                .allowsHitTesting(false)
                                .accessibilityHidden(true)
                        }
                    }
            }
        }
        .background(Color.frSurface)
        .clipShape(RoundedRectangle(cornerRadius: FRMetrics.cardRadius, style: .continuous))
    }
}
