import FantasyReelAPI
import FantasyReelCore
import Observation
import SwiftUI
import UIKit

/// The account's push switches (O-01, D-10). Stored on the server, so they
/// follow the account to every iPhone; the inbox and email never change.
@Observable
@MainActor
final class PushSettingsModel {
    private(set) var preferences: LoadState<PushPreferences> = .idle
    let save = AsyncAction()

    private let userID: UserID
    private let repository: any PushRepository

    init(userID: UserID, repository: any PushRepository) {
        self.userID = userID
        self.repository = repository
    }

    func load() async {
        if preferences.value == nil { preferences = .loading }
        do {
            preferences = .loaded(try await repository.preferences(for: userID))
        } catch {
            if preferences.value == nil { preferences = .failed(message: error.userMessage) }
        }
    }

    /// Flips the switch at once and puts it back if the save fails.
    func set(_ category: PushCategory, to enabled: Bool) {
        guard !save.isRunning, var updated = preferences.value else { return }
        let previous = updated
        updated[category] = enabled
        preferences = .loaded(updated)
        save.run { [self] in
            do {
                try await repository.savePreferences(updated, for: userID)
            } catch {
                preferences = .loaded(previous)
                throw error
            }
        }
    }
}

struct PushSettingsView: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(SessionStore.self) private var session

    var body: some View {
        if let account = session.account {
            PushSettingsContent(model: PushSettingsModel(userID: account.id, repository: environment.push.repository))
                .id(account.id)
        }
    }
}

private struct PushSettingsContent: View {
    @State var model: PushSettingsModel
    @Environment(AppEnvironment.self) private var environment
    @Environment(\.openURL) private var openURL
    @State private var asking = AsyncAction()

    private var push: PushCenter { environment.push }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenHeader("Push Notifications")
                    .padding(.bottom, 4)
                permission
                categories
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 32)
        }
        .background(Color.frBackground)
        .navigationTitle("Push Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(verbatim: "").accessibilityHidden(true)
            }
        }
        .task {
            await push.refreshAuthorization()
            await model.load()
        }
        .refreshable { await model.load() }
        .announcesError(model.save.errorMessage)
    }

    // MARK: Permission

    @ViewBuilder
    private var permission: some View {
        switch push.authorization {
        case .notDetermined:
            FRCard {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Notifications are off on this iPhone")
                        .frFont(.cardTitle)
                        .foregroundStyle(Color.frText)
                    Text("Turn them on to hear about your picks, bids and trades without opening the app.")
                        .frFont(.body)
                        .foregroundStyle(Color.frTextSecondary)
                    Button("Turn On Notifications") {
                        asking.run { await push.requestPermission() }
                    }
                    .buttonStyle(.fr(.primary, isLoading: asking.isRunning))
                    .disabled(asking.isRunning)
                }
            }
        case .denied:
            InlineBanner(
                tone: .warning,
                title: "Notifications are off for Fantasy Reel",
                message: "Turn them on in iPhone Settings to get these on this phone.",
                actionTitle: "Open Settings",
                actionPlacement: .below
            ) {
                if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
            }
        case .allowed, nil:
            EmptyView()
        }
    }

    // MARK: Categories

    private var categories: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("Send me")
            switch model.preferences {
            case .idle, .loading:
                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    ForEach(PushCategory.allCases) { category in
                        HStack {
                            label(category)
                            Spacer(minLength: 8)
                            ProgressView().controlSize(.small)
                        }
                        .padding(.vertical, 10)
                        .padding(.horizontal, FRMetrics.rowPadding)
                        .frame(minHeight: 50)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Loading notification settings")
            case .failed(let message):
                ErrorStateView(title: "Couldn't load notification settings", message: message, layout: .card) {
                    Task { await model.load() }
                }
            case .empty:
                EmptyView()
            case .loaded(let preferences):
                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    ForEach(PushCategory.allCases) { category in
                        Toggle(isOn: Binding(
                            get: { preferences[category] },
                            set: { model.set(category, to: $0) }
                        )) {
                            label(category)
                        }
                        .disabled(model.save.isRunning)
                        .padding(.vertical, 10)
                        .padding(.horizontal, FRMetrics.rowPadding)
                        .frame(minHeight: 50)
                    }
                }
                if let message = model.save.errorMessage {
                    InlineBanner(tone: .error, title: message)
                }
            }
            GroupFootnote("Saved to your account, so they apply on every iPhone you sign in on. Your inbox and emails don't change.")
        }
    }

    private func label(_ category: PushCategory) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(category.title)
                .frFont(.rowLabel)
                .foregroundStyle(Color.frText)
            Text(category.detail)
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
        }
    }
}

/// The in-context ask (App Review 4.5.4): shown on League Home and in the
/// draft room until the person answers iOS or taps Not Now. Settings keeps
/// the switch either way.
struct PushPromptCard: View {
    @Environment(AppEnvironment.self) private var environment
    @State private var asking = AsyncAction()

    /// Reads `PushCenter.authorization`, which `RootView` fills at launch, so
    /// nothing shows until iOS has answered.
    var body: some View {
        if environment.push.showsPrompt {
            FRCard(tone: .gold) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Image(systemName: "bell.badge.fill")
                            .foregroundStyle(Color.frGold)
                            .accessibilityHidden(true)
                        Text("Know when it's your turn")
                            .frFont(.cardTitle)
                            .foregroundStyle(Color.frText)
                    }
                    Text("Get a push when it's your pick, you're outbid, or a trade is waiting on you. You choose which in Account.")
                        .frFont(.body)
                        .foregroundStyle(Color.frTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 12) {
                        Button("Not Now") { environment.push.dismissPrompt() }
                            .buttonStyle(.fr(.neutral, size: .medium, fullWidth: true))
                            .disabled(asking.isRunning)
                        Button("Turn On") {
                            asking.run { await environment.push.requestPermission() }
                        }
                        .buttonStyle(.fr(.primary, size: .medium, isLoading: asking.isRunning, fullWidth: true))
                        .disabled(asking.isRunning)
                    }
                }
            }
        }
    }
}
