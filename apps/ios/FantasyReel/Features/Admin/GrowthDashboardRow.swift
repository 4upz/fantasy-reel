import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation
import SwiftUI

/// Whether the signed-in account is an app administrator, and the growth
/// stats it last loaded (F-18).
///
/// The only authority is `admin_growth_stats()`: it returns the stats for an
/// administrator and refuses everyone else (`fetchGrowthStats()` → nil). There
/// is no client-side admin flag. `SignedInRootView` owns one per signed-in
/// tree (like `InboxStore`), so a sign-out or account switch drops the answer
/// and the cached stats; nothing is written to disk.
@Observable
@MainActor
final class AdminStore {
    /// The server's answer: true for an administrator, false otherwise, nil
    /// until answered.
    private(set) var isAdmin: Bool?
    /// The stats the last check or dashboard load returned, so the dashboard
    /// opens with numbers while it refreshes.
    private(set) var stats: GrowthStats?
    /// The charts' points and labels for `stats`, built once per load.
    private(set) var chartData: GrowthChartData?
    /// When `stats` arrived.
    private(set) var statsLoadedAt: Date?

    @ObservationIgnored private var isChecking = false
    @ObservationIgnored private var retryAfter: Date?

    private let repository: any AdminRepository

    /// Seconds before a failed check (offline, server error) may run again.
    private static let retryDelay: TimeInterval = 60
    /// Stats younger than this are shown without asking the server again.
    static let freshness: TimeInterval = 60

    init(repository: any AdminRepository) {
        self.repository = repository
    }

    /// True when the cached stats are recent enough to skip a reload.
    var hasFreshStats: Bool {
        guard stats != nil, let statsLoadedAt else { return false }
        return Date().timeIntervalSince(statsLoadedAt) < Self.freshness
    }

    /// Asks the server once per signed-in session, unless a check is running
    /// or one failed moments ago.
    func checkIfNeeded() async {
        guard isAdmin == nil, !isChecking else { return }
        if let retryAfter, retryAfter > Date() { return }
        isChecking = true
        defer { isChecking = false }
        do {
            record(try await repository.fetchGrowthStats())
            retryAfter = nil
        } catch {
            // Unknown, not "no": try again later rather than hiding the row
            // for the rest of the session.
            retryAfter = Date().addingTimeInterval(Self.retryDelay)
        }
    }

    /// Loads fresh stats (nil: not, or no longer, an administrator).
    func loadStats() async throws(APIError) -> GrowthStats? {
        let fresh = try await repository.fetchGrowthStats()
        record(fresh)
        return fresh
    }

    private func record(_ fresh: GrowthStats?) {
        isAdmin = fresh != nil
        stats = fresh
        chartData = fresh.map(GrowthChartData.init(stats:))
        statsLoadedAt = fresh == nil ? nil : Date()
    }
}

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
