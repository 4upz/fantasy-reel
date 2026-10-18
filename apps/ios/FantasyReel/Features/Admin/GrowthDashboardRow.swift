import SwiftUI

/// The Account screen's link to the growth dashboard, shown only once the
/// server says this account is an app administrator. Account starts the check
/// (`AdminStore.checkIfNeeded()`) from its own `.task`: this row is absent for
/// everyone else, and an absent view never runs a task.
struct GrowthDashboardRow: View {
    @Environment(AdminStore.self) private var admin

    var body: some View {
        if admin.isAdmin == true {
            NavigationLink(value: MenuRoute.growthDashboard) {
                ListRow(
                    title: "Growth Dashboard",
                    meta: "Admins only",
                    showsChevron: true,
                    accessibilityLabel: "Growth Dashboard, admins only"
                ) {
                    Image(systemName: "chart.xyaxis.line")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Color.frGold)
                        .frame(width: 36, height: 36)
                        .background(Color.frGoldTint, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .accessibilityHidden(true)
                } trailing: {
                    EmptyView()
                }
            }
            .buttonStyle(.frRow)
        }
    }
}
