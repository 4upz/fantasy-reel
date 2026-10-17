import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// The commissioner announcement composer (F-15): 1–1500 characters, posted as
/// an embed to every Discord channel linked to the league, with the actual
/// result ("Posted to 2 Discord channels", or no linked channel).
struct DiscordAnnouncementView: View {
    let season: League
    let model: SettingsModel

    static let maxLength = 1500

    @State private var message = ""
    /// Channels reached by the last post; nil before any post.
    @State private var channelsNotified: Int?
    @FocusState private var isEditing: Bool

    private var trimmed: String {
        message.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// UTF-16 length, as the web counts it.
    private var length: Int { message.utf16.count }
    private var charsOver: Int { length - Self.maxLength }
    private var canPost: Bool { !trimmed.isEmpty && charsOver <= 0 && !model.announcement.isRunning }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                ScreenHeader("Announcement", eyebrow: "\(season.name) · \(String(season.seasonYear)) Season")
                SettingsFootnote("Post a message to every Discord channel linked to this league.")

                ZStack(alignment: .topLeading) {
                    if message.isEmpty {
                        Text("Draft trade deadline is Friday -- get your business in before then.")
                            .frFont(.input)
                            .foregroundStyle(Color.frTextMuted)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 8)
                            .accessibilityHidden(true)
                    }
                    TextEditor(text: $message)
                        .frFont(.input)
                        .foregroundStyle(Color.frText)
                        .scrollContentBackground(.hidden)
                        .focused($isEditing)
                        .frame(minHeight: 160)
                        .accessibilityLabel("Message")
                        .accessibilityValue(message.isEmpty ? "Empty" : message)
                }
                .padding(12)
                .background(Color.frSurface, in: RoundedRectangle(cornerRadius: FRMetrics.cardRadius, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: FRMetrics.cardRadius, style: .continuous)
                        .strokeBorder(charsOver > 0 ? Color.frError : Color.clear, lineWidth: 1)
                }
                .disabled(model.announcement.isRunning)

                HStack(alignment: .firstTextBaseline) {
                    SettingsFootnote("Sent as an embed to every linked channel, regardless of their notification settings")
                    Text("\(length)/\(Self.maxLength)")
                        .frFont(.meta)
                        .monospacedDigit()
                        .foregroundStyle(charsOver > 0 ? Color.frError : Color.frTextSecondary)
                        .accessibilityLabel("\(length) of \(Self.maxLength) characters")
                }
                .padding(.horizontal, 4)

                if charsOver > 0 {
                    SettingsFieldError(
                        "The message is \(SettingsText.plural(charsOver, "character", "characters")) too long."
                    )
                }

                if let channelsNotified {
                    if channelsNotified > 0 {
                        InlineBanner(
                            tone: .success,
                            title: "Posted to \(SettingsText.plural(channelsNotified, "Discord channel", "Discord channels"))"
                        )
                    } else {
                        InlineBanner(
                            tone: .info,
                            title: "No Discord channels are linked to this league yet",
                            message: "Link one with /set-league in Discord. See the Discord bot guide in Settings."
                        )
                    }
                }

                if let error = model.announcement.errorMessage {
                    InlineBanner(tone: .error, title: error)
                }

                Button(action: post) {
                    Text(model.announcement.isRunning ? "Posting…" : "Post to Discord")
                }
                .buttonStyle(.fr(.primary, isLoading: model.announcement.isRunning))
                .disabled(!canPost)
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 32)
        }
        .background(Color.frBackground)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Post Announcement")
        .navigationBarTitleDisplayMode(.inline)
        .announcesError(model.announcement.errorMessage)
    }

    private func post() {
        guard canPost else { return }
        let text = trimmed
        channelsNotified = nil
        isEditing = false
        model.postAnnouncement(text) { count in
            channelsNotified = count
            if count > 0 {
                message = ""
                Announcer.announce("Posted to \(SettingsText.plural(count, "Discord channel", "Discord channels")).")
            } else {
                Announcer.announce("No Discord channels are linked to this league yet.")
            }
        }
    }
}
