import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// Owner settings: every F-15 section, end season and delete (F-15, F-16).
/// Pushed onto a league tab's stack from the league `⋯` menu (owner only).
struct LeagueSettingsView: View {
    var body: some View {
        SettingsScreen(title: "Settings") { selection, model in
            SettingsContent(selection: selection, model: model)
        }
    }
}

/// End Season, pushed from Settings' danger zone (`LeagueRoute.endSeason`).
struct SettingsEndSeasonScreen: View {
    var body: some View {
        SettingsScreen(title: "End Season") { selection, model in
            SettingsEndSeasonView(season: selection.season, model: model)
        }
    }
}

/// Delete Season, pushed from Settings' danger zone (`LeagueRoute.deleteSeason`).
struct SettingsDeleteSeasonScreen: View {
    var body: some View {
        SettingsScreen(title: "Delete season") { selection, model in
            SettingsDeleteSeasonView(season: selection.season, model: model)
        }
    }
}

/// The announcement composer, pushed from Settings (`LeagueRoute.postAnnouncement`).
struct DiscordAnnouncementScreen: View {
    var body: some View {
        SettingsScreen(title: "Announcement") { selection, model in
            DiscordAnnouncementView(season: selection.season, model: model)
        }
    }
}

/// Hosts an owner settings screen: builds its `SettingsModel` once (not on
/// every parent render) from the environment's repositories and the selected
/// season, and shows the owner-only notice to anyone else. The shell is
/// rebuilt per season, so the model never outlives its season.
private struct SettingsScreen<Content: View>: View {
    let title: String
    @ViewBuilder let content: (LeagueSelection, SettingsModel) -> Content

    @Environment(\.leagueSelection) private var selection
    @Environment(AppEnvironment.self) private var environment
    @Environment(LeagueDirectoryStore.self) private var directory

    @State private var model: SettingsModel?

    var body: some View {
        Group {
            if let selection, selection.isOwner {
                if let model {
                    content(selection, model)
                } else {
                    LoadingView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color.frBackground)
                }
            } else {
                ScrollView {
                    EmptyStateView(
                        title: "Only the commissioner can change settings",
                        message: "Ask the league's commissioner if something needs to change.",
                        systemImage: "lock"
                    )
                    .padding(.horizontal, FRMetrics.pageMargin)
                    .padding(.top, 48)
                }
                .background(Color.frBackground)
            }
        }
        .headerScreenTitle(title)
        .onAppear(perform: makeModelIfNeeded)
    }

    private func makeModelIfNeeded() {
        guard model == nil, let selection, selection.isOwner else { return }
        model = SettingsModel(
            seasonID: selection.season.id,
            leagues: environment.leagues,
            lifecycle: environment.leagueLifecycle,
            announcements: environment.announcements,
            directory: directory
        )
    }
}

/// The owner's settings for the selected season. The season itself is read
/// from the selection on every render, so a save (which refreshes the
/// directory) shows the server's values.
private struct SettingsContent: View {
    let selection: LeagueSelection
    let model: SettingsModel

    @Environment(AppEnvironment.self) private var environment
    @Environment(ShellRouter.self) private var router
    @Environment(LeagueDirectoryStore.self) private var directory

    private var season: League { selection.season }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                ScreenHeader("Settings", eyebrow: "\(season.name) · \(String(season.seasonYear)) Season", status: season.status)

                SettingsGeneralSection(season: season, model: model)
                SettingsSeasonSection(season: season, model: model)
                SettingsScoringSection(season: season, model: model)
                SettingsRosterSection(season: season, model: model)
                SettingsCounterpickSection(season: season, model: model)
                SettingsTradingSection(season: season, model: model)
                SettingsDraftOrderSection(selection: selection)
                SettingsParticipantsSection(season: season, currentUserID: selection.userID, model: model)

                discordBotSection
                discordSection
                SettingsJoiningSection(season: season, model: model)

                if season.status == .completed {
                    SettingsNextSeasonSection(season: season)
                }

                SettingsDangerZoneSection(season: season)
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 32)
        }
        .background(Color.frBackground)
        .scrollDismissesKeyboard(.interactively)
        .task {
            guard !model.hasLoadedMembers else { return }
            await model.loadMembers()
        }
        .refreshable {
            async let refreshed: Void = directory.refresh()
            async let membersLoaded: Void = model.loadMembers()
            await refreshed
            await membersLoaded
        }
    }

    private var discordBotSection: some View {
        VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader("Discord Bot")
                    .padding(.bottom, 4)
                FRCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Post league updates to your Discord server.")
                            .frFont(.bodySmall)
                            .foregroundStyle(Color.frTextSecondary)
                        DiscordBotGuideView(
                            leagueLink: DiscordBotGuideView.leagueLink(
                                siteURL: environment.configuration.siteURL,
                                leagueID: season.id
                            ),
                            installURL: DiscordBotGuideView.installLink(
                                clientID: environment.configuration.discordClientID
                            ),
                            onOpenAccount: { router.presentMenu(.account) }
                        )
                    }
                }
            }
            DiscordBotCommandsSection()
        }
    }

    private var discordSection: some View {
        SettingsSection("Discord") {
            SettingsActionRow(
                "Post Announcement…",
                detail: "Post a message to every Discord channel linked to this league"
            ) {
                router.push(.postAnnouncement)
            }
        } footer: {
            FRFootnote("Link channels and choose alerts with the bot's commands in Discord.")
        }
    }
}
