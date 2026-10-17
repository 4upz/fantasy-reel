import SwiftUI

/// Signed-out welcome (mockup v2 "Welcome"): what the game is, Create Account,
/// Log In, and legal/support links (F-01). It shows no movie data, so it has
/// no TMDb attribution; that goes on the screens that do.
struct WelcomeView: View {
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        // The visible height (inside the safe area), so the content can fill
        // it and pin the actions to the bottom (V2Welcome's flex spacer) yet
        // still scroll at large text sizes.
        GeometryReader { viewport in
            ScrollView {
                VStack(spacing: FRMetrics.sectionSpacing) {
                    Image("Wordmark")
                        .resizable()
                        .scaledToFit()
                        .frame(height: 44)
                        .accessibilityLabel("Fantasy Reel")
                        .padding(.top, 40)

                    Text("Draft upcoming movies. Beat your friends on the Tomatometer.")
                        .frFont(.pageTitle)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(Color.frText)
                        .accessibilityAddTraits(.isHeader)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 8)
                        .padding(.top, 8)

                    Text("A season-long fantasy league for the films you can't wait to see.")
                        .frFont(.body)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(Color.frTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 16)

                    FRRowGroup {
                        StepRow(number: 1, title: "Draft movies before release", detail: "Snake draft this year's releases")
                        StepRow(number: 2, title: "Score on the Tomatometer", detail: "Above 60% earns points, below loses")
                        StepRow(number: 3, title: "Bid and trade all season", detail: "Spend your budget, swap with rivals")
                    }
                    .padding(.top, 12)
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel("How it plays")

                    Spacer(minLength: 24)

                    VStack(spacing: 12) {
                        NavigationLink("Create Account", value: AuthRoute.signUp)
                            .buttonStyle(.frPrimary)
                        NavigationLink("Log In", value: AuthRoute.logIn)
                            .buttonStyle(.frSecondary)
                    }

                    HStack(spacing: 8) {
                        Link("Privacy", destination: LegalLinks.privacy(site: environment.configuration.siteURL))
                            .padding(.horizontal, 12)
                        Link("Terms", destination: LegalLinks.terms(site: environment.configuration.siteURL))
                            .padding(.horizontal, 12)
                        Link("Support", destination: SupportLinks.email)
                            .padding(.horizontal, 12)
                    }
                    .frFont(.meta)
                    .frame(minHeight: FRMetrics.minTapTarget)
                    .padding(.top, 4)
                }
                .padding(.horizontal, FRMetrics.pageMargin)
                .padding(.bottom, 8)
                // idealHeight too: the scroll view proposes no height, and the ideal
                // stands in for it so the Spacer can expand to fill the viewport.
                // Under that fixed proposal the VStack would squeeze its text to one
                // line, so each Text above takes its full height (fixedSize).
                .frame(minHeight: viewport.size.height, idealHeight: viewport.size.height, alignment: .top)
            }
        }
        .background(alignment: .top) {
            WelcomeGlow()
        }
        .background(Color.frBackground)
        .toolbar(.hidden, for: .navigationBar)
    }
}

/// V2Welcome's warm glow: a gold-tint radial gradient centered 120pt from the
/// top of the screen, fading out over 190pt.
private struct WelcomeGlow: View {
    var body: some View {
        RadialGradient(
            colors: [Color.frGoldTint, Color.frGoldTint.opacity(0)],
            center: .center,
            startRadius: 0,
            endRadius: 190
        )
        .frame(width: 380, height: 380)
        .offset(y: -70)
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct StepRow: View {
    let number: Int
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: 12) {
            // Fixed 16pt (V2Welcome `.ibadge.num`): the number sits in a fixed
            // 32pt circle, so it doesn't scale with Dynamic Type.
            Text(String(number))
                .font(FRFonts.fixedFont(.bricolage, weight: 700, size: 16, numeric: true))
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
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .frame(minHeight: FRMetrics.rowHeight)
        .padding(.horizontal, 16)
        .accessibilityElement(children: .combine)
    }
}
