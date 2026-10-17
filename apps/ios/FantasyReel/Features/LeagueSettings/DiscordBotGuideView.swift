import FantasyReelAPI
import FantasyReelCore
import SwiftUI
import UIKit

/// How to add the Fantasy Reel Discord bot (`DiscordBotGuide.tsx`): the
/// install button (only when a client ID is configured), three setup steps,
/// the league link with a copy button. Read-only; the caller supplies the
/// heading and places `DiscordBotCommandsSection` after the card. Also usable
/// from How to Play (no league link).
struct DiscordBotGuideView: View {
    private let leagueLink: String?
    private let installURL: URL?
    private let onOpenAccount: (() -> Void)?

    @Environment(\.openURL) private var openURL
    @State private var copied = false
    /// The step number circle grows with Dynamic Type.
    @ScaledMetric(relativeTo: .body) private var stepCircle: CGFloat = 26

    init(leagueLink: String? = nil, installURL: URL? = nil, onOpenAccount: (() -> Void)? = nil) {
        self.leagueLink = leagueLink
        self.installURL = installURL
        self.onOpenAccount = onOpenAccount
    }

    /// A few everyday commands (`DISCORD_BOT_COMMANDS` in `utils/discordBot.ts`).
    static let commands: [DiscordBotCommand] = [
        DiscordBotCommand(name: "/standings", description: "League standings"),
        DiscordBotCommand(name: "/my-team", description: "Your roster, shown only to you"),
        DiscordBotCommand(name: "/roster", description: "Any team's roster"),
        DiscordBotCommand(name: "/movie", description: "Look up a movie and who owns it"),
        DiscordBotCommand(name: "/upcoming", description: "Rostered movies releasing soon"),
        DiscordBotCommand(name: "/current-bids", description: "Movies with active bids"),
    ]

    /// View Channels (1 << 10) and Manage Webhooks (1 << 29), as the web asks for.
    private static let botPermissions = (1 << 10) | (1 << 29)

    /// The server-install link for the bot, or nil when no client ID is set.
    static func installLink(clientID: String?) -> URL? {
        guard let clientID, !clientID.isEmpty else { return nil }
        var components = URLComponents()
        components.scheme = "https"
        components.host = "discord.com"
        components.path = "/oauth2/authorize"
        components.queryItems = [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "scope", value: "bot applications.commands"),
            URLQueryItem(name: "permissions", value: String(botPermissions)),
            URLQueryItem(name: "integration_type", value: "0"),
        ]
        return components.url
    }

    /// `<site>/league/<id>`, the link `/set-league` takes.
    static func leagueLink(siteURL: URL, leagueID: LeagueID) -> String {
        var base = siteURL.absoluteString
        while base.hasSuffix("/") { base.removeLast() }
        return base + "/league/" + leagueID.rawValue
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let installURL {
                Button {
                    openURL(installURL)
                } label: {
                    Label("Add to Discord", systemImage: "arrow.up.right.square")
                }
                .buttonStyle(.frPrimary)
                .accessibilityHint("Opens Discord")
            }

            VStack(alignment: .leading, spacing: 14) {
                step(1, title: "Add the bot to your server") {
                    Text("You need the Manage Server permission on that Discord server.")
                }
                step(2, title: "Connect your Discord account") {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Connect Discord in Account so the bot knows which manager you are.")
                        if let onOpenAccount {
                            Button("Open Account", action: onOpenAccount)
                                .buttonStyle(.fr(.secondary, size: .compact))
                        }
                    }
                }
                step(3, title: "Link a channel to your league") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(
                            "In the channel where you want league updates, run /set-league and paste your "
                                + "league's link. League owners and anyone with Manage Server can link a channel. "
                                + "Then use /configure to choose which updates post there."
                        )
                        if let leagueLink {
                            copyRow(leagueLink)
                        }
                    }
                }
            }
        }
    }

    private func step<Content: View>(_ number: Int, title: String, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(number)")
                .frFont(.numberSmall)
                .foregroundStyle(Color.frOnGold)
                .frame(width: stepCircle, height: stepCircle)
                .background(Color.frGold, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .frFont(.rowTitle)
                    .foregroundStyle(Color.frText)
                    .accessibilityLabel("Step \(number): \(title)")
                content()
                    .frFont(.bodySmall)
                    .foregroundStyle(Color.frTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func copyRow(_ link: String) -> some View {
        HStack(spacing: 8) {
            Text(link)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(Color.frText)
                .lineLimit(2)
                .truncationMode(.middle)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                UIPasteboard.general.string = link
                copied = true
                Announcer.announce("League link copied.")
            } label: {
                Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
            }
            .buttonStyle(.fr(.secondary, size: .compact))
            .accessibilityLabel(copied ? "League link copied" : "Copy league link")
        }
        .padding(.leading, 12)
        .padding(.vertical, 4)
        .background(Color.frElevated, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/// "Commands to try": the guide's sample commands as their own section, so
/// they sit in a row group rather than a card inside the guide's card.
struct DiscordBotCommandsSection: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("Commands to try")
                .padding(.bottom, 4)
            FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                ForEach(DiscordBotGuideView.commands, id: \.name) { command in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(command.name)
                            .font(.system(.subheadline, design: .monospaced))
                            .foregroundStyle(Color.frGold)
                        Text(command.description)
                            .frFont(.bodySmall)
                            .foregroundStyle(Color.frTextSecondary)
                    }
                    .padding(.horizontal, FRMetrics.rowPadding)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

/// One sample bot command for the guide.
struct DiscordBotCommand: Hashable, Sendable {
    let name: String
    let description: String
}
