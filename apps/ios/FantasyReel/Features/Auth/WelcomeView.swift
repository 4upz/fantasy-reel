import SwiftUI

/// Signed-out welcome (mockup v2 "Welcome"): what the game is, Create Account,
/// Log In, and legal/support links with movie-data attribution (F-01).
struct WelcomeView: View {
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        ScrollView {
            VStack(spacing: FRMetrics.sectionSpacing) {
                Image("Wordmark")
                    .resizable()
                    .scaledToFit()
                    .frame(height: 44)
                    .accessibilityLabel("Fantasy Reel")
                    .padding(.top, 24)

                Text("Draft upcoming movies. Beat your friends on the Tomatometer.")
                    .frFont(.pageTitle)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Color.frText)
                    .accessibilityAddTraits(.isHeader)

                Text("A season-long fantasy league for the films you can't wait to see.")
                    .frFont(.body)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Color.frTextSecondary)

                FRRowGroup {
                    StepRow(number: 1, title: "Draft movies before release", detail: "Snake draft this year's releases")
                    StepRow(number: 2, title: "Score on the Tomatometer", detail: "Above 60% earns points, below loses")
                    StepRow(number: 3, title: "Bid and trade all season", detail: "Spend your budget, swap with rivals")
                }
                .padding(.top, 12)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("How it plays")

                VStack(spacing: 12) {
                    NavigationLink("Create Account", value: AuthRoute.signUp)
                        .buttonStyle(.frPrimary)
                    NavigationLink("Log In", value: AuthRoute.logIn)
                        .buttonStyle(.frSecondary)
                }
                .padding(.top, 24)

                HStack(spacing: 8) {
                    Link("Privacy", destination: LegalLinks.privacy(site: environment.configuration.siteURL))
                    Link("Terms", destination: LegalLinks.terms(site: environment.configuration.siteURL))
                    Link("Support", destination: SupportLinks.email)
                }
                .frFont(.meta)
                .frame(minHeight: FRMetrics.minTapTarget)

                Text("Movie data from TMDb. This product uses the TMDb API but is not endorsed or certified by TMDb.")
                    .frFont(.caption)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Color.frTextSecondary)
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
        .toolbar(.hidden, for: .navigationBar)
    }
}

private struct StepRow: View {
    let number: Int
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: 12) {
            Text(String(number))
                .frFont(.number)
                .foregroundStyle(Color.frGold)
                .frame(width: 32, height: 32)
                .background(Color.frGoldTint, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .frFont(.rowTitle)
                    .foregroundStyle(Color.frText)
                Text(detail)
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: FRMetrics.rowHeight)
        .padding(.horizontal, 16)
        .accessibilityElement(children: .combine)
    }
}
