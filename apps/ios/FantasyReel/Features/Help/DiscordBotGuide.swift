import SwiftUI

/// The league-independent Discord bot guide (F-17): `DiscordBotGuideView`'s
/// install button and steps in a card, then the sample commands. How to Play
/// and the Account screen's Discord Bot row use it; league settings builds its
/// own with the league link. Each caller supplies its own heading.
struct DiscordBotGuide: View {
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            FRCard {
                DiscordBotGuideView(
                    installURL: DiscordBotGuideView.installLink(
                        clientID: environment.configuration.discordClientID
                    )
                )
            }
            DiscordBotCommandsSection()
        }
    }
}

/// The guide on its own screen, pushed in the menu sheet (F-17).
struct DiscordBotGuideScreen: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                ScreenHeader("Discord Bot")
                Text("Bring your league into your Discord server. The Fantasy Reel bot posts draft picks, bid results, trades, and score updates to the channel you choose, and answers commands like standings and rosters without leaving the chat.")
                    .frFont(.body)
                    .foregroundStyle(Color.frTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 4)
                DiscordBotGuide()
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 32)
        }
        .background(Color.frBackground)
        .navigationTitle("Discord Bot")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(verbatim: "").accessibilityHidden(true)
            }
        }
    }
}
