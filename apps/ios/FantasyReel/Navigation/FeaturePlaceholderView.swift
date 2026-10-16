import SwiftUI

/// Stand-in body for a screen a feature thread hasn't built yet. The shell
/// already routes to every screen, so each one can be replaced independently:
/// keep the screen's type name and initializer, replace its `body`.
struct FeaturePlaceholderView: View {
    let title: String
    /// Requirement IDs the real screen implements (docs/IOS-REQUIREMENTS.md).
    let requirements: String
    let systemImage: String
    /// Whether this is a tab root, which draws its own large header under the top bar.
    var showsHeader = true

    @Environment(\.leagueSelection) private var selection

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                if showsHeader {
                    ScreenHeader(
                        title,
                        subtitle: selection.map { "\($0.season.name) · \(String($0.season.seasonYear)) Season" },
                        status: selection?.season.status
                    )
                }
                EmptyStateView(
                    title: "Coming soon",
                    message: "This screen is next on the build list (\(requirements)).",
                    systemImage: systemImage
                )
                .padding(.top, 24)
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.frBackground)
        .navigationTitle(showsHeader ? "" : title)
    }
}
