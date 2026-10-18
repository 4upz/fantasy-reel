import SwiftUI

/// The restricted growth dashboard (F-18): app administrators only, authorized
/// by `admin_growth_stats()` on the server. Pushed in the menu sheet's stack.
struct GrowthDashboardView: View {
    var body: some View {
        FeaturePlaceholderView(title: "Growth", requirements: "F-18", systemImage: "chart.xyaxis.line", showsHeader: false)
    }
}

/// The Account screen's link to the growth dashboard. Renders nothing unless
/// the server says this account is an app administrator, so the Account
/// screen can place it unconditionally.
struct GrowthDashboardRow: View {
    var body: some View {
        EmptyView()
    }
}
