import SwiftUI

/// Shown once after Sign in with Apple makes a new account behind Hide My Email
/// (L-01). Apple's private relay address can't match an existing account, so
/// someone who already plays with Google, Discord or email would otherwise land
/// in an empty account and think their leagues are gone.
struct AppleRelayNoticeView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                Text("New Account Created")
                    .frFont(.largeTitle)
                    .foregroundStyle(Color.frText)
                    .accessibilityAddTraits(.isHeader)
                Text("You used Hide My Email with Apple, so we made a new Fantasy Reel account for that private address.")
                    .frFont(.body)
                    .foregroundStyle(Color.frTextSecondary)
                InlineBanner(
                    tone: .info,
                    title: "Already play Fantasy Reel?",
                    message: "Your leagues are on the account you made with Google, Discord or email. Sign out, sign in that way, then connect Apple in Account so Sign in with Apple opens those leagues next time.",
                    systemImage: "person.2.fill",
                    iconStyle: .badge
                )
                .padding(.top, 8)
                Button("Continue with New Account") {
                    session.showsAppleRelayNotice = false
                }
                .buttonStyle(.frPrimary)
                .padding(.top, 8)
                Button("Sign Out") {
                    Task { await session.signOut() }
                }
                .buttonStyle(.frSecondary)
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.vertical, 24)
        }
        .background(Color.frBackground)
    }
}

#if DEBUG
#Preview("Apple relay notice") {
    let environment = AppEnvironment.preview()
    AppleRelayNoticeView()
        .environment(environment)
        .environment(environment.session)
}
#endif
