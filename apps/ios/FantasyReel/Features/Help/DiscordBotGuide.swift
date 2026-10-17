import SwiftUI

/// How to add the Fantasy Reel Discord bot (F-17, web `DiscordBotGuide`): the
/// install link, three setup steps and a few commands. The wording is the
/// web's. Each caller supplies its own heading.
struct DiscordBotGuide: View {
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let install = environment.configuration.discordBotInstallURL {
                Link(destination: install) {
                    HStack(spacing: 10) {
                        Image("DiscordLogo")
                            .renderingMode(.template)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 22, height: 22)
                            .accessibilityHidden(true)
                        Text("Add to Discord")
                        Image(systemName: "arrow.up.right")
                            .font(.footnote.weight(.semibold))
                            .accessibilityHidden(true)
                    }
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .foregroundStyle(.white)
                    .background(Self.blurple, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .frFont(.control)
                .accessibilityHint("Opens Discord in Safari.")
            }

            VStack(alignment: .leading, spacing: 0) {
                GuideStep(number: 1, title: "Add the bot to your server") {
                    Text("You need the Manage Server permission on that Discord server.")
                }
                GuideStep(number: 2, title: "Connect your Discord account") {
                    Text("Connect Discord in Account so the bot knows which manager you are.")
                }
                GuideStep(number: 3, title: "Link a channel to your league", isLast: true) {
                    Text(stepThree)
                }
            }
            .padding(.vertical, 4)
            .background(Color.frSurface, in: RoundedRectangle(cornerRadius: FRMetrics.cardRadius, style: .continuous))

            VStack(alignment: .leading, spacing: 8) {
                Text("Commands to try")
                    .frFont(.rowTitle)
                    .foregroundStyle(Color.frText)
                    .padding(.horizontal, 4)
                    .accessibilityAddTraits(.isHeader)
                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    ForEach(Self.commands, id: \.name) { command in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(command.name)
                                .font(.system(.subheadline, design: .monospaced).weight(.semibold))
                                .foregroundStyle(Color.frGold)
                            Text(command.description)
                                .frFont(.bodySmall)
                                .foregroundStyle(Color.frTextSecondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, FRMetrics.rowPadding)
                        .padding(.vertical, 10)
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }

    private var stepThree: AttributedString {
        var text = AttributedString("In the channel where you want league updates, run ")
        text.append(Self.code("/set-league"))
        text.append(AttributedString(" and paste your league's link. League owners and anyone with Manage Server can link a channel. Then use "))
        text.append(Self.code("/configure"))
        text.append(AttributedString(" to choose which updates post there."))
        return text
    }

    private static func code(_ command: String) -> AttributedString {
        var code = AttributedString(command)
        code.font = .system(.subheadline, design: .monospaced).weight(.semibold)
        code.foregroundColor = .frText
        return code
    }

    /// Discord's brand blurple, for its own button only.
    static let blurple = Color(red: 0x58 / 255, green: 0x65 / 255, blue: 0xF2 / 255)

    struct Command {
        let name: String
        let description: String
    }

    /// The web's `DISCORD_BOT_COMMANDS`.
    static let commands = [
        Command(name: "/standings", description: "League standings"),
        Command(name: "/my-team", description: "Your roster, shown only to you"),
        Command(name: "/roster", description: "Any team's roster"),
        Command(name: "/movie", description: "Look up a movie and who owns it"),
        Command(name: "/upcoming", description: "Rostered movies releasing soon"),
        Command(name: "/current-bids", description: "Movies with active bids"),
    ]
}

/// One numbered step: a gold number badge, a title and its detail.
private struct GuideStep<Detail: View>: View {
    let number: Int
    let title: String
    var isLast = false
    @ViewBuilder let detail: Detail

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(String(number))
                .font(FRFonts.fixedFont(.bricolage, weight: 700, size: 15, numeric: true))
                .foregroundStyle(Color.frGold)
                .frame(width: 28, height: 28)
                .background(Color.frGoldTint, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .frFont(.rowTitle)
                    .foregroundStyle(Color.frText)
                    .accessibilityLabel("Step \(number): \(title)")
                detail
                    .frFont(.body)
                    .foregroundStyle(Color.frTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, FRMetrics.rowPadding)
        .padding(.vertical, 12)
        .accessibilityElement(children: .contain)
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
