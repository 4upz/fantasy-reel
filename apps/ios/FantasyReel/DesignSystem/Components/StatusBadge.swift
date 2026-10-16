import FantasyReelCore
import SwiftUI

/// A league season's phase as a badge: Setup (info blue), Drafting and
/// Counterpicking (draft yellow), Active (green), Completed (gray). Unknown
/// phases from a newer server render neutrally with the server's name.
struct StatusBadge: View {
    private let status: LeagueStatus

    init(status: LeagueStatus) {
        self.status = status
    }

    var body: some View {
        FRBadge(status.displayName, tone: tone)
    }

    private var tone: FRTone {
        switch status {
        case .setup: .info
        case .drafting, .counterpicking: .draft
        case .active: .success
        case .completed: .done
        default: .neutral
        }
    }
}

#if DEBUG
#Preview("Status badges") {
    FRPreviewCanvas {
        HStack {
            StatusBadge(status: .setup)
            StatusBadge(status: .drafting)
            StatusBadge(status: .counterpicking)
        }
        HStack {
            StatusBadge(status: .active)
            StatusBadge(status: .completed)
            StatusBadge(status: .unknown("paused"))
        }
    }
}
#endif
