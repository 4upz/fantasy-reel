import FantasyReelCore
import SwiftUI

/// The large sheet behind the league pill (mockup v2 "Leagues and menu sheet"):
/// switch leagues, create or join, invitations, then Wishlist, Notifications,
/// Account, How to Play and Support. It has its own stack, so those screens push
/// inside the sheet instead of opening a second sheet.
struct MenuSheetView: View {
    @Environment(ShellRouter.self) private var router
    @Environment(LeagueDirectoryStore.self) private var directory

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $router.menuPath) {
            MenuRootView()
                .navigationDestination(for: MenuRoute.self) { route in
                    switch route {
                    case .notifications: NotificationsView()
                    case .wishlist: WishlistView()
                    case .account: AccountView()
                    case .howToPlay: HowToPlayView()
                    case .editDisplayName: EditDisplayNameView()
                    case .changePassword: ChangePasswordView()
                    case .deleteAccount: DeleteAccountView()
                    case .discordBot: DiscordBotGuideScreen()
                    case .growthDashboard: GrowthDashboardView()
                    case .sharedWishlist(let owner): SharedWishlistView(owner: owner)
                    case .league(let route):
                        LeagueDestinationView(route: route)
                            .environment(\.leagueSelection, directory.selection)
                    }
                }
        }
        .environment(\.routesThroughMenu, true)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

private struct MenuRootView: View {
    @Environment(ShellRouter.self) private var router
    @Environment(LeagueDirectoryStore.self) private var directory
    @Environment(InboxStore.self) private var inbox
    @Environment(WishlistStore.self) private var wishlist
    @Environment(\.currentProfile) private var profile
    @Environment(SessionStore.self) private var session
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                leagues
                seasons
                PendingInvitationsSection()
                links
            }
            .task {
                if case .idle = wishlist.state { await wishlist.load() }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
        .navigationTitle("Leagues")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Close", systemImage: "xmark") {
                    router.dismissSheet()
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: MenuRoute.account) {
                    Avatar(name: displayName, imageURL: profile?.avatarURL, size: .medium)
                }
                .accessibilityLabel("Account, \(displayName)")
            }
        }
    }

    private var displayName: String {
        profile?.displayName ?? session.account?.email ?? "You"
    }

    private var leagues: some View {
        FRRowGroup {
            ForEach(directory.entries) { entry in
                Button {
                    directory.select(entry.entrySeason.id)
                    router.dismissSheet()
                } label: {
                    // A "Your pick" badge (V2Menu) goes in LeagueMenuRow once the
                    // directory knows whose turn it is in a drafting season.
                    LeagueMenuRow(entry: entry, isCurrent: entry.seasons.contains { $0.id == directory.selectedSeasonID })
                }
                .buttonStyle(.plain)
            }
            Button {
                router.present(.createLeague)
            } label: {
                MenuActionRow(title: "Create League", systemImage: "plus")
            }
            .buttonStyle(.plain)
            Button {
                router.present(.joinLeague(.manual))
            } label: {
                MenuActionRow(title: "Join with Code", systemImage: "link")
            }
            .buttonStyle(.plain)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Your leagues")
    }

    /// The current league's seasons (F-04), when it has more than one: the
    /// season menu within a league. Each season the account can read is listed;
    /// joining a later season doesn't grant earlier ones.
    @ViewBuilder
    private var seasons: some View {
        if let selection = directory.selection, selection.seriesSeasons.count >= 2 {
            SectionHeader("Seasons")
            FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                ForEach(selection.seriesSeasons) { season in
                    Button {
                        directory.select(season.id)
                        router.dismissSheet()
                    } label: {
                        MenuSeasonRow(season: season, isSelected: season.id == selection.season.id)
                    }
                    .buttonStyle(.plain)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Seasons of \(selection.season.name)")
        }
    }

    private var links: some View {
        FRRowGroup {
            NavigationLink(value: MenuRoute.wishlist) {
                MenuLinkRow(title: "Wishlist", systemImage: "bookmark", value: wishlist.count > 0 ? "\(wishlist.count)" : nil)
            }
            NavigationLink(value: MenuRoute.notifications) {
                MenuLinkRow(title: "Notifications", systemImage: "bell", count: inbox.unreadCount)
            }
            NavigationLink(value: MenuRoute.account) {
                MenuLinkRow(title: "Account", systemImage: "person.crop.circle")
            }
            NavigationLink(value: MenuRoute.howToPlay) {
                MenuLinkRow(title: "How to Play", systemImage: "info.circle")
            }
            Link(destination: SupportLinks.email) {
                MenuLinkRow(title: "Support", systemImage: "envelope", trailing: .external)
            }
        }
        .buttonStyle(.plain)
        .padding(.top, FRMetrics.sectionSpacing)
    }
}

/// One league in the menu: avatar, name, entry season and phase.
private struct LeagueMenuRow: View {
    let entry: LeagueDirectoryEntry
    let isCurrent: Bool

    var body: some View {
        HStack(spacing: 12) {
            Avatar(name: entry.name, size: .medium)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.name)
                    .frFont(.rowTitle)
                    .foregroundStyle(Color.frText)
                    .lineLimit(1)
                Text("\(String(entry.entrySeason.seasonYear)) Season · \(entry.entrySeason.status.displayName)")
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if isCurrent {
                Image(systemName: "checkmark")
                    .foregroundStyle(Color.frGold)
                    .accessibilityHidden(true)
            }
        }
        .frame(minHeight: FRMetrics.rowHeight)
        .padding(.horizontal, 16)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
    }
}

/// One season of the current league: "2026 Season · Active", checked when selected.
private struct MenuSeasonRow: View {
    let season: League
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "calendar")
                .foregroundStyle(Color.frTextSecondary)
                .frame(width: 36)
                .accessibilityHidden(true)
            Text("\(String(season.seasonYear)) Season · \(season.status.displayName)")
                .frFont(.rowLabel)
                .foregroundStyle(Color.frText)
                .frame(maxWidth: .infinity, alignment: .leading)
            if isSelected {
                Image(systemName: "checkmark")
                    .foregroundStyle(Color.frGold)
                    .accessibilityHidden(true)
            }
        }
        .frame(minHeight: 48)
        .padding(.horizontal, 16)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

private struct MenuActionRow: View {
    let title: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .frame(width: 36)
                .accessibilityHidden(true)
            Text(title)
                .frFont(.rowLabel)
            Spacer()
        }
        .foregroundStyle(Color.frGold)
        .frame(minHeight: 52)
        .padding(.horizontal, 16)
        .contentShape(Rectangle())
    }
}

private struct MenuLinkRow: View {
    enum Trailing {
        /// Pushes inside the sheet.
        case chevron
        /// Leaves the app (mail, web): `arrow.up.right`.
        case external
    }

    let title: String
    let systemImage: String
    var count: Int = 0
    /// Secondary text before the chevron (the wishlist's "12").
    var value: String?
    var trailing: Trailing = .chevron

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .foregroundStyle(Color.frTextSecondary)
                .frame(width: 36)
                .accessibilityHidden(true)
            Text(title)
                .frFont(.rowLabel)
                .foregroundStyle(Color.frText)
            Spacer()
            if let value {
                Text(value)
                    .frFont(.label)
                    .foregroundStyle(Color.frTextSecondary)
            }
            if count > 0 {
                CountBadge(count: count)
                    .accessibilityLabel("\(count) unread")
            }
            Image(systemName: trailing == .external ? "arrow.up.right" : "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Color.frTextMuted)
                .accessibilityHidden(true)
        }
        .frame(minHeight: 48)
        .padding(.horizontal, 16)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

enum SupportLinks {
    static let email = URL(string: "mailto:support@fantasyreel.com")!
}
