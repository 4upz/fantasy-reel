import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// Owner settings: every F-15 section, end season and delete (F-15, F-16).
/// Pushed onto a league tab's stack from the league `⋯` menu (owner only).
struct LeagueSettingsView: View {
    @Environment(\.leagueSelection) private var selection
    @Environment(AppEnvironment.self) private var environment
    @Environment(LeagueDirectoryStore.self) private var directory

    var body: some View {
        Group {
            if let selection, selection.isOwner {
                SettingsContent(selection: selection, environment: environment, directory: directory)
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
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// The owner's settings for the selected season. The model lives as long as
/// this screen; the season itself is read from the selection on every render,
/// so a save (which refreshes the directory) shows the server's values.
private struct SettingsContent: View {
    let selection: LeagueSelection

    @State private var model: SettingsModel
    @State private var destination: SettingsDestination?

    @Environment(AppEnvironment.self) private var environment
    @Environment(ShellRouter.self) private var router
    @Environment(LeagueDirectoryStore.self) private var directory

    init(selection: LeagueSelection, environment: AppEnvironment, directory: LeagueDirectoryStore) {
        self.selection = selection
        _model = State(
            initialValue: SettingsModel(
                seasonID: selection.season.id,
                leagues: environment.leagues,
                lifecycle: environment.leagueLifecycle,
                announcements: environment.announcements,
                directory: directory
            )
        )
    }

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

                VStack(alignment: .leading, spacing: 8) {
                    SectionHeader("Joining")
                        .padding(.bottom, 4)
                    JoinCodeCard(season: season)
                }

                discordSection

                if season.status == .completed {
                    SettingsNextSeasonSection(season: season)
                }

                SettingsDangerZoneSection(season: season, destination: $destination)
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 32)
        }
        .background(Color.frBackground)
        .scrollDismissesKeyboard(.interactively)
        .task {
            await model.loadMembers()
        }
        .refreshable {
            await directory.refresh()
            await model.loadMembers()
        }
        .navigationDestination(item: $destination) { destination in
            switch destination {
            case .endSeason:
                SettingsEndSeasonView(season: season, model: model)
            case .deleteSeason:
                SettingsDeleteSeasonView(season: season, model: model)
            case .announcement:
                DiscordAnnouncementView(season: season, model: model)
            }
        }
    }

    private var discordSection: some View {
        VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            SettingsSection("Discord") {
                SettingsActionRow(
                    "Post Announcement…",
                    detail: "Post a message to every Discord channel linked to this league"
                ) {
                    model.announcement.clearError()
                    destination = .announcement
                }
            } footer: {
                SettingsFootnote("Link channels and choose alerts with the bot's commands in Discord.")
            }

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
        }
    }
}
