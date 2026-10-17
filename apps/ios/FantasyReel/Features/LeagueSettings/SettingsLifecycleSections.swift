import FantasyReelAPI
import FantasyReelCore
import SwiftUI

// Settings sections about people and the season's lifecycle: draft order
// (which lives on the Draft tab), participants, rollover, and the danger zone
// with its typed confirmations (F-15, F-16).

// MARK: - Draft order

/// Draft order is set on the Draft tab; settings only points there.
struct SettingsDraftOrderSection: View {
    let selection: LeagueSelection

    @Environment(ShellRouter.self) private var router

    var body: some View {
        if selection.season.status == .setup {
            SettingsSection("Draft order") {
                if selection.tabs.contains(.draft) {
                    SettingsActionRow("Draft order", detail: "Set the draft order on the Draft tab.") {
                        router.select(.draft)
                    }
                } else {
                    SettingsValueRow("Draft order", value: "Draft tab")
                }
            }
        } else {
            SettingsSection("Draft order") {
                SettingsValueRow("Draft order", value: "Set", isLocked: true)
            } footer: {
                SettingsLockNote("Draft order cannot be changed after the draft has started.")
            }
        }
    }
}

// MARK: - Participants

struct SettingsParticipantsSection: View {
    let season: League
    let currentUserID: UserID
    let model: SettingsModel

    @State private var removalTarget: LeagueMember?

    private var isSetup: Bool { season.status == .setup }

    private func canRemove(_ member: LeagueMember) -> Bool {
        isSetup && member.participant.role != .owner && member.userID != currentUserID
    }

    var body: some View {
        SettingsSection("Participants", error: model.removal.errorMessage) {
            switch model.members {
            case .idle, .loading:
                HStack(spacing: 12) {
                    ProgressView()
                    Text("Loading participants…")
                        .frFont(.label)
                        .foregroundStyle(Color.frTextSecondary)
                }
                .padding(.horizontal, FRMetrics.rowPadding)
                .frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
            case .empty:
                SettingsValueRow("No participants yet", value: "")
            case .failed(let message):
                HStack(spacing: 12) {
                    Text(message)
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button("Try Again") {
                        Task { await model.loadMembers() }
                    }
                    .buttonStyle(.fr(.secondary, size: .compact))
                }
                .padding(.horizontal, FRMetrics.rowPadding)
                .padding(.vertical, 8)
                .frame(minHeight: 50)
            case .loaded(let members):
                ForEach(members) { member in
                    row(member)
                }
            }
        } footer: {
            if !isSetup {
                SettingsLockNote("Participants cannot be removed after the draft has started.")
            } else {
                FRFootnote("Removed participants need a new invitation to rejoin.")
            }
        }
        .confirmationDialog(
            removalTarget.map { "Remove \($0.displayName)?" } ?? "Remove participant?",
            isPresented: Binding(
                get: { removalTarget != nil },
                set: { if !$0 { removalTarget = nil } }
            ),
            titleVisibility: .visible,
            presenting: removalTarget
        ) { member in
            Button("Remove", role: .destructive) {
                model.remove(member)
            }
            Button("Cancel", role: .cancel) {}
        } message: { member in
            Text("Are you sure you want to remove \(member.displayName) from the league? They will need a new invitation to rejoin.")
        }
    }

    private func row(_ member: LeagueMember) -> some View {
        let isOwner = member.participant.role == .owner
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(member.displayName)
                        .frFont(.rowTitle)
                        .foregroundStyle(Color.frText)
                    if isOwner {
                        FRBadge("Commissioner", tone: .gold, systemImage: "crown.fill")
                    }
                }
                if let team = member.team {
                    Text(team.name)
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            if canRemove(member) {
                Button("Remove") {
                    model.removal.clearError()
                    removalTarget = member
                }
                .buttonStyle(.fr(.destructive, size: .compact))
                .disabled(model.removal.isRunning)
                .accessibilityLabel("Remove \(member.displayName) from league")
            }
        }
        .padding(.horizontal, FRMetrics.rowPadding)
        .padding(.vertical, 8)
        .frame(minHeight: FRMetrics.rowHeight)
    }
}

// MARK: - Next season

/// A completed season: rollover happens on Home (`CompletedSeasonHomeView`).
struct SettingsNextSeasonSection: View {
    let season: League

    @Environment(ShellRouter.self) private var router

    var body: some View {
        SettingsSection("Next season") {
            SettingsActionRow(
                "Start the \(String(season.seasonYear + 1)) season",
                detail: "From Home. Carries everyone over with their team names. Rosters start empty."
            ) {
                router.select(.home)
            }
        } footer: {
            FRFootnote("This season is complete. Its results are final.")
        }
    }
}

// MARK: - Danger zone

/// End Season (active) or Delete Season (setup), each a pushed typed
/// confirmation (`LeagueRoute.endSeason` / `.deleteSeason`).
struct SettingsDangerZoneSection: View {
    let season: League

    @Environment(ShellRouter.self) private var router

    private var year: String { String(season.seasonYear) }

    var body: some View {
        switch season.status {
        case .active:
            SettingsSection("Danger zone") {
                SettingsActionRow("End Season…", tone: .frCrimsonText) {
                    router.push(.endSeason)
                }
            } footer: {
                FRFootnote(
                    "Ends the \(year) Season now: final scoring, champions, pending bids cancelled, "
                        + "open trades expired. You'll type \(year) to confirm."
                )
            }
        case .setup:
            SettingsSection("Danger zone") {
                SettingsActionRow("Delete season…", tone: .frCrimsonText) {
                    router.push(.deleteSeason)
                }
            } footer: {
                FRFootnote(
                    "Permanently deletes the \(year) season of \(season.name). "
                        + "You'll type the league name to confirm."
                )
            }
        case .drafting, .counterpicking:
            SettingsSection("Danger zone") {
                SettingsValueRow("Delete season", value: "Unavailable", isLocked: true)
            } footer: {
                SettingsLockNote(
                    "A season can't be deleted after the draft has started. You can end the season once it's active."
                )
            }
        case .completed, .unknown:
            EmptyView()
        }
    }
}

/// A short bulleted line for the confirmation screens.
private struct SettingsBullet: View {
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(verbatim: "•")
                .accessibilityHidden(true)
            Text(text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frFont(.body)
        .foregroundStyle(Color.frText)
    }
}

/// Ending a season (F-16): consequences first, then the season year typed
/// exactly. Irreversible, so a mistimed end is made visibly wrong first.
struct SettingsEndSeasonView: View {
    let season: League
    let model: SettingsModel

    @State private var confirmText = ""
    @FocusState private var isConfirmFocused: Bool
    @Environment(\.dismiss) private var dismiss

    private var year: String { String(season.seasonYear) }
    private var isConfirmed: Bool {
        confirmText.trimmingCharacters(in: .whitespacesAndNewlines) == year
    }

    private var daysEarly: Int {
        DateOnly.today().days(until: season.seasonEnd)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                ScreenHeader("End the season?", eyebrow: "\(season.name) · \(year) Season")
                FRCard {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Ending the \(year) Season:")
                            .frFont(.rowTitle)
                            .foregroundStyle(Color.frText)
                        SettingsBullet(text: "Runs final scoring and ranks the final standings.")
                        SettingsBullet(text: "Records the champions. Teams tied for first share the title.")
                        SettingsBullet(text: "Cancels every pending bid, uncharged.")
                        SettingsBullet(text: "Expires every open trade offer.")
                        SettingsBullet(text: "Scores stop updating, and bids, trades and drops close.")
                        SettingsBullet(text: "Everyone gets the final standings.")
                    }
                }
                if daysEarly > 0 {
                    InlineBanner(
                        tone: .warning,
                        title: "Ending early",
                        message: "This season isn't scheduled to end until \(season.seasonEnd.formattedFull) — "
                            + "you're freezing scores \(SettingsText.plural(daysEarly, "day", "days")) early."
                    )
                }
                FRFootnote("This can't be undone. There is no way to reopen a season.")
                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    FormFieldRow(label: "Type \(year)", labelWidth: 110) {
                        TextField(year, text: $confirmText)
                            .keyboardType(.numberPad)
                            .autocorrectionDisabled()
                            .focused($isConfirmFocused)
                            .accessibilityLabel("Type \(year) to confirm")
                    }
                }
                .disabled(model.completion.isRunning)
                if let message = model.completion.errorMessage {
                    InlineBanner(tone: .error, title: message)
                }
                Button {
                    endSeason()
                } label: {
                    Text(model.completion.isRunning ? "Ending…" : "End Season")
                }
                .buttonStyle(.fr(.destructive, isLoading: model.completion.isRunning))
                .disabled(!isConfirmed || model.completion.isRunning)
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 32)
        }
        .background(Color.frBackground)
        .scrollDismissesKeyboard(.interactively)
        .toolbar {
            // The number pad has no return key.
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { isConfirmFocused = false }
            }
        }
        .announcesError(model.completion.errorMessage)
    }

    private func endSeason() {
        guard isConfirmed, season.status == .active else { return }
        model.save(.completeSeason, with: model.completion) {
            Announcer.announce("The \(year) season has ended.")
            dismiss()
        }
    }
}

/// Deleting a setup season: the league name typed exactly, as on the web.
struct SettingsDeleteSeasonView: View {
    let season: League
    let model: SettingsModel

    @State private var confirmText = ""
    @Environment(\.dismiss) private var dismiss

    private var isConfirmed: Bool { confirmText == season.name }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                ScreenHeader("Delete season", eyebrow: "\(season.name) · \(String(season.seasonYear)) Season")
                FRCard(tone: .error) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("This permanently deletes the \(String(season.seasonYear)) season of \(season.name), with:")
                            .frFont(.rowTitle)
                            .foregroundStyle(Color.frText)
                            .fixedSize(horizontal: false, vertical: true)
                        SettingsBullet(text: "Its participants and their teams")
                        SettingsBullet(text: "Every invitation and join code sent for it")
                        SettingsBullet(text: "Its draft settings and draft order")
                        Text("This action cannot be undone.")
                            .frFont(.label)
                            .foregroundStyle(Color.frCrimsonText)
                            .padding(.top, 4)
                    }
                }
                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    FormFieldRow(label: "League name", labelWidth: 110) {
                        TextField("Enter league name", text: $confirmText)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .accessibilityLabel("Type \(season.name) to confirm")
                    }
                }
                .disabled(model.deletion.isRunning)
                FRFootnote("Type \(season.name) to confirm. Must match the league name exactly, including capital letters.")
                if let message = model.deletion.errorMessage {
                    InlineBanner(tone: .error, title: message)
                }
                Button {
                    deleteSeason()
                } label: {
                    Text(model.deletion.isRunning ? "Deleting…" : "Delete season")
                }
                .buttonStyle(.fr(.destructive, isLoading: model.deletion.isRunning))
                .disabled(!isConfirmed || model.deletion.isRunning)
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 32)
        }
        .background(Color.frBackground)
        .scrollDismissesKeyboard(.interactively)
        .announcesError(model.deletion.errorMessage)
    }

    private func deleteSeason() {
        guard isConfirmed, season.status == .setup else { return }
        // `save` refreshes the directory afterwards; the deleted season drops
        // out, the selection falls back, and the shell rebuilds without it.
        model.save(.deleteSeason, with: model.deletion) {
            Announcer.announce("Season deleted.")
            dismiss()
        }
    }
}
