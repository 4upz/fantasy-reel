import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation
import SwiftUI

/// Whether each signed-in account is an app administrator, asked of the
/// server once per launch (F-18).
///
/// The only authority is `admin_growth_stats()`: it returns the stats for an
/// administrator and refuses everyone else (`fetchGrowthStats()` → nil). There
/// is no client-side admin flag. Keyed by user ID so a different account on
/// the same launch is asked again; nothing is written to disk.
@Observable
@MainActor
final class AdminAccess {
    static let shared = AdminAccess()

    /// The server's answer per account: true for an administrator, false
    /// otherwise. Missing until answered.
    private(set) var isAdminByUser: [UserID: Bool] = [:]
    /// The stats the last check or dashboard load returned, so the dashboard
    /// opens with numbers while it refreshes.
    private(set) var cachedStats: [UserID: GrowthStats] = [:]

    @ObservationIgnored private var inFlight: Set<UserID> = []
    @ObservationIgnored private var retryAfter: [UserID: Date] = [:]

    /// Seconds before a failed check (offline, server error) may run again.
    private static let retryDelay: TimeInterval = 60

    func isAdmin(_ userID: UserID) -> Bool {
        isAdminByUser[userID] == true
    }

    /// Starts the check for `userID` unless it was answered this launch, is
    /// running, or failed moments ago. Safe to call while rendering: it only
    /// touches untracked bookkeeping synchronously and records the answer
    /// from a task afterwards.
    func checkIfNeeded(userID: UserID, repository: any AdminRepository) {
        guard isAdminByUser[userID] == nil, !inFlight.contains(userID) else { return }
        if let retryAfter = retryAfter[userID], retryAfter > Date() { return }
        inFlight.insert(userID)
        Task {
            await self.check(userID: userID, repository: repository)
        }
    }

    /// Records a fresh answer (nil stats: not an administrator).
    func record(_ stats: GrowthStats?, for userID: UserID) {
        isAdminByUser[userID] = stats != nil
        cachedStats[userID] = stats
    }

    private func check(userID: UserID, repository: any AdminRepository) async {
        defer { inFlight.remove(userID) }
        do {
            let stats = try await repository.fetchGrowthStats()
            retryAfter[userID] = nil
            record(stats, for: userID)
        } catch {
            // Unknown, not "no": try again later rather than hiding the row
            // for the rest of the launch.
            retryAfter[userID] = Date().addingTimeInterval(Self.retryDelay)
        }
    }
}

/// The Account screen's link to the growth dashboard. Renders nothing unless
/// the server says this account is an app administrator, so the Account
/// screen can place it unconditionally. It lives in the menu sheet's stack.
struct GrowthDashboardRow: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(SessionStore.self) private var session

    var body: some View {
        if let userID = session.account?.id {
            // Asked here rather than in `.task`: this view is empty for
            // everyone else, and an empty view never appears, so a task on it
            // would never run.
            let _ = AdminAccess.shared.checkIfNeeded(userID: userID, repository: environment.admin)
            if AdminAccess.shared.isAdmin(userID) {
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
}
