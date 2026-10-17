import AuthenticationServices
import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// Account (mockup v2 "Account", F-03, F-02, L-01, L-02, D-11): profile photo
/// and name, appearance, password, connected accounts, the Season recaps
/// email, help and legal, support requests, Log Out and Delete Account.
///
/// Pushed inside the menu sheet; its edit screens push on the same stack, so
/// nothing here opens a second sheet. The photo menu's system pickers (Photos,
/// Files) are the one exception, and they are the system's own.
struct AccountView: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(SessionStore.self) private var session
    @Environment(ProfileStore.self) private var profiles

    var body: some View {
        if let account = session.account {
            AccountContent(model: AccountModel(
                userID: account.id,
                session: session,
                account: environment.account,
                storage: environment.avatarStorage,
                profiles: profiles
            ), email: account.email)
        }
    }
}

private struct AccountContent: View {
    @State var model: AccountModel
    let email: String?

    @Environment(AppEnvironment.self) private var environment
    @Environment(SessionStore.self) private var session
    @Environment(ProfileStore.self) private var profiles
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @AppStorage(AppearancePreference.storageKey) private var appearance: AppearancePreference = .system
    @State private var appleAuthorizer = AppleAuthorizer()
    @State private var pendingDisconnect: PendingDisconnect?
    @State private var logOut = AsyncAction()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                ScreenHeader("Account")
                    .padding(.bottom, 4)
                profileCard
                profileRows
                connectedAccounts
                emailSection
                helpRows
                supportRows
                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    Button {
                        logOut.run { await session.signOut() }
                    } label: {
                        SettingsRow(logOut.isRunning ? "Logging Out…" : "Log Out", accessory: .none, role: .destructive)
                    }
                    .buttonStyle(.frRow)
                    .disabled(logOut.isRunning)
                }
                .padding(.top, FRMetrics.sectionSpacing)
                VStack(alignment: .leading, spacing: 8) {
                    FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                        NavigationLink(value: MenuRoute.deleteAccount) {
                            SettingsRow("Delete Account…", accessory: .none, role: .destructive)
                        }
                        .buttonStyle(.frRow)
                    }
                    GroupFootnote("Leagues you run pass to another member. This can't be undone.")
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 32)
        }
        .background(Color.frBackground)
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(verbatim: "").accessibilityHidden(true)
            }
        }
        .task { await model.load() }
        .refreshable {
            async let profile: Void = profiles.refresh()
            async let rest: Void = model.load()
            _ = await (profile, rest)
        }
        .announcesError(model.photo.errorMessage)
        .announcesError(model.connection.errorMessage)
        .announcesError(model.recaps.errorMessage)
        .confirmationDialog(
            pendingDisconnect.map { "Disconnect \($0.name)?" } ?? "",
            isPresented: Binding(get: { pendingDisconnect != nil }, set: { if !$0 { pendingDisconnect = nil } }),
            titleVisibility: .visible,
            presenting: pendingDisconnect
        ) { pending in
            Button("Disconnect \(pending.name)", role: .destructive) {
                model.disconnect(pending.identity, name: pending.name)
            }
        } message: { pending in
            Text("You won't be able to sign in with \(pending.name) until you connect it again. Your leagues stay as they are.")
        }
    }

    private var displayName: String {
        profiles.profile?.displayName ?? email ?? "You"
    }

    // MARK: Profile

    private var profileCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 16) {
                EditableAvatar(
                    name: displayName,
                    imageURL: profiles.profile?.avatarURL,
                    isBusy: model.photo.isRunning,
                    onPick: model.upload,
                    onRemove: model.removePhoto,
                    onError: model.reportPhotoProblem
                )
                VStack(alignment: .leading, spacing: 2) {
                    Text(displayName)
                        .frFont(.cardTitle)
                        .foregroundStyle(Color.frText)
                        .lineLimit(2)
                    if let email {
                        Text(email)
                            .frFont(.body)
                            .foregroundStyle(Color.frTextSecondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    Text("Contact Support to change email")
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextMuted)
                }
                .accessibilityElement(children: .combine)
                Spacer(minLength: 0)
            }
            if let message = model.photo.errorMessage {
                InlineBanner(tone: .error, title: message)
            }
        }
        .padding(FRMetrics.rowPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.frSurface, in: RoundedRectangle(cornerRadius: FRMetrics.cardRadius, style: .continuous))
    }

    private var profileRows: some View {
        FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
            NavigationLink(value: MenuRoute.editDisplayName) {
                SettingsRow("Display name", value: profiles.profile?.displayName)
            }
            .buttonStyle(.frRow)
            HStack(spacing: 12) {
                Text("Appearance")
                    .frFont(.rowLabel)
                    .foregroundStyle(Color.frText)
                Spacer(minLength: 8)
                FRSegmentedControl("Appearance", selection: $appearance, options: AppearancePreference.allCases, track: .elevated, title: { $0.title })
                    .frame(maxWidth: 220)
            }
            .padding(.horizontal, FRMetrics.rowPadding)
            .frame(minHeight: 50)
            NavigationLink(value: MenuRoute.changePassword) {
                SettingsRow("Change Password")
            }
            .buttonStyle(.frRow)
        }
    }

    // MARK: Connected accounts

    private var connectedAccounts: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("Connected accounts")
            switch model.methods {
            case .idle, .loading:
                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    ForEach(AuthService.OAuthProvider.allCases, id: \.self) { provider in
                        SettingsRow(provider.displayName, accessory: .none) {
                            ProgressView().controlSize(.small)
                        }
                    }
                }
                .accessibilityLabel("Loading connected accounts")
            case .failed(let message):
                ErrorStateView(title: "Couldn't load connected accounts", message: message, layout: .card) {
                    Task { await model.load() }
                }
            case .empty:
                EmptyView()
            case .loaded(let methods):
                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    ForEach(AuthService.OAuthProvider.allCases, id: \.self) { provider in
                        providerRow(provider, methods: methods)
                    }
                }
                if let message = model.connection.errorMessage {
                    InlineBanner(tone: .error, title: message)
                }
                if !methods.hasPassword && methods.identities.count == 1 {
                    GroupFootnote("Connect another way to sign in before disconnecting this one.")
                }
            }
        }
        .padding(.top, FRMetrics.sectionSpacing)
    }

    @ViewBuilder
    private func providerRow(_ provider: AuthService.OAuthProvider, methods: SignInMethods) -> some View {
        if let identity = methods.identity(for: provider) {
            let detail = provider == .discord
                ? profiles.profile?.discordUsername.map { "@\($0)" } ?? identity.detail
                : identity.detail
            Menu {
                Button("Disconnect \(provider.displayName)", systemImage: "link.badge.minus", role: .destructive) {
                    pendingDisconnect = PendingDisconnect(identity: identity, name: provider.displayName)
                }
                .disabled(!methods.canDisconnectProvider)
            } label: {
                SettingsRow(provider.displayName, value: detail, accessory: .none) {
                    Image(systemName: "checkmark")
                        .foregroundStyle(Color.frSuccess)
                        .accessibilityLabel("Connected")
                }
            }
            .menuStyle(.button)
            .buttonStyle(.frRow)
            .disabled(model.connection.isRunning)
            .accessibilityHint(methods.canDisconnectProvider ? "Shows the option to disconnect." : "This is your only way to sign in.")
        } else {
            Button {
                connect(provider)
            } label: {
                SettingsRow(provider.displayName, accessory: .none) {
                    Text("Connect")
                        .frFont(.control)
                        .foregroundStyle(Color.frGold)
                }
            }
            .buttonStyle(.frRow)
            .disabled(model.connection.isRunning)
            .accessibilityLabel("Connect \(provider.displayName)")
        }
    }

    private func connect(_ provider: AuthService.OAuthProvider) {
        guard provider == .apple else {
            let scheme = environment.configuration.urlScheme
            let webSession = webAuthenticationSession
            model.connect(provider) { url in
                do {
                    return try await webSession.authenticate(
                        using: url,
                        callback: .customScheme(scheme),
                        preferredBrowserSession: .shared,
                        additionalHeaderFields: [:]
                    )
                } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
                    return nil
                }
            }
            return
        }
        Task {
            let rawNonce = AppleNonce.make()
            let authorization: ASAuthorization
            do {
                authorization = try await appleAuthorizer.authorize(hashedNonce: AppleNonce.sha256(rawNonce), scopes: [.email])
            } catch let error as ASAuthorizationError where error.code == .canceled {
                return
            } catch is CancellationError {
                return
            } catch {
                model.reportConnectionProblem(AppleSignInError.failed)
                return
            }
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let idToken = String(data: tokenData, encoding: .utf8)
            else {
                model.reportConnectionProblem(AppleSignInError.incomplete)
                return
            }
            model.connectApple(idToken: idToken, nonce: rawNonce)
        }
    }

    // MARK: Email

    private var emailSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("Email")
            FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                Toggle(isOn: Binding(
                    get: { model.seasonRecaps ?? false },
                    set: { model.setSeasonRecaps($0) }
                )) {
                    Text("Season recaps")
                        .frFont(.rowLabel)
                        .foregroundStyle(Color.frText)
                }
                .tint(Color.frGold)
                .disabled(model.seasonRecaps == nil || model.recaps.isRunning)
                .padding(.horizontal, FRMetrics.rowPadding)
                .frame(minHeight: 50)
            }
            if let message = model.recaps.errorMessage ?? model.recapsError {
                InlineBanner(tone: .error, title: message)
            }
            GroupFootnote("Final standings when a season you played in ends. Emails about your invitations, bids and trades always arrive.")
        }
        .padding(.top, FRMetrics.sectionSpacing)
    }

    // MARK: Help, legal, support

    private var helpRows: some View {
        FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
            NavigationLink(value: MenuRoute.howToPlay) {
                SettingsRow("How to Play")
            }
            .buttonStyle(.frRow)
            Link(destination: SupportLinks.email) {
                SettingsRow("Support", accessory: .external)
            }
            .buttonStyle(.frRow)
            Link(destination: LegalLinks.privacy(site: environment.configuration.siteURL)) {
                SettingsRow("Privacy Policy", accessory: .external)
            }
            .buttonStyle(.frRow)
            Link(destination: LegalLinks.terms(site: environment.configuration.siteURL)) {
                SettingsRow("Terms of Service", accessory: .external)
            }
            .buttonStyle(.frRow)
        }
        .padding(.top, FRMetrics.sectionSpacing)
    }

    /// Data export is a support request until it is self-service (D-11).
    /// The Growth Dashboard row (F-18, admins only) joins this group.
    private var supportRows: some View {
        FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
            Link(destination: SupportLinks.dataExport) {
                SettingsRow("Request Data Export", accessory: .external)
            }
            .buttonStyle(.frRow)
        }
    }
}

private struct PendingDisconnect {
    let identity: LinkedIdentity
    let name: String
}

extension SupportLinks {
    /// A prefilled request: data export goes through support (D-11).
    static let dataExport = URL(string: "mailto:support@fantasyreel.com?subject=Data%20export%20request")!
}
