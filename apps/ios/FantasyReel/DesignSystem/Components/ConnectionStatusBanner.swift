import SwiftUI

/// How fresh a live screen's data is (draft board, bids). Mirrors the web's
/// draft connection states: Realtime connected, reconnecting, the bounded
/// polling fallback ("periodic updates"), and no network.
enum ConnectionStatus: Hashable, Sendable {
    case live
    case reconnecting
    case periodicUpdates
    case offline

    var title: String {
        switch self {
        case .live: "Live"
        case .reconnecting: "Reconnecting…"
        case .periodicUpdates: "Periodic updates"
        case .offline: "Offline"
        }
    }

    var defaultMessage: String {
        switch self {
        case .live: "Changes appear as they happen."
        case .reconnecting: "Showing the last saved data."
        case .periodicUpdates: "Checking for changes every few seconds."
        case .offline: "Check your connection."
        }
    }

    var tone: FRTone {
        switch self {
        case .live: .success
        case .reconnecting, .offline: .warning
        case .periodicUpdates: .info
        }
    }

    var systemImage: String {
        switch self {
        case .live: "dot.radiowaves.left.and.right"
        case .reconnecting: "arrow.triangle.2.circlepath"
        case .periodicUpdates: "clock.arrow.circlepath"
        case .offline: "wifi.slash"
        }
    }
}

/// The 52pt tinted status pill from V2DraftOffline: "Reconnecting… Showing last
/// saved draft." Usually hidden while `.live`.
///
/// One VoiceOver element. It does not announce itself; announce a status
/// *change* once with `Announcer.announce(_:)` so a flapping connection doesn't
/// keep interrupting the screen reader.
struct ConnectionStatusBanner: View {
    private let status: ConnectionStatus
    private let message: String?

    init(status: ConnectionStatus, message: String? = nil) {
        self.status = status
        self.message = message
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: status.systemImage)
                .font(.body.weight(.semibold))
                .foregroundStyle(status.tone.foreground)
                .accessibilityHidden(true)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 4) { texts }
                    .lineLimit(1)
                VStack(alignment: .leading, spacing: 2) { texts }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, FRMetrics.cardPadding)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
        .background(status.tone.background, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var texts: some View {
        Text(status.title)
            .frFont(.controlSmall)
            .foregroundStyle(Color.frText)
        Text(message ?? status.defaultMessage)
            .frFont(.label)
            .foregroundStyle(Color.frTextSecondary)
    }
}

/// The compact header indicator: an 8pt dot plus the status word ("● Offline").
/// The word carries the meaning; the dot only echoes it.
struct ConnectionStatusIndicator: View {
    private let status: ConnectionStatus

    init(status: ConnectionStatus) {
        self.status = status
    }

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(status.tone.foreground)
                .frame(width: 8, height: 8)
                .accessibilityHidden(true)
            Text(status == .reconnecting ? "Reconnecting" : status.title)
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
        }
        .accessibilityElement(children: .combine)
    }
}

#if DEBUG
#Preview("Connection · dark") {
    FRPreviewCanvas {
        ConnectionStatusBanner(status: .reconnecting, message: "Showing last saved draft.")
        ConnectionStatusBanner(status: .periodicUpdates)
        ConnectionStatusBanner(status: .offline)
        ConnectionStatusBanner(status: .live)
        HStack(spacing: 16) {
            ForEach([ConnectionStatus.live, .reconnecting, .periodicUpdates, .offline], id: \.self) {
                ConnectionStatusIndicator(status: $0)
            }
        }
    }
}

#Preview("Connection · light") {
    FRPreviewCanvas {
        ConnectionStatusBanner(status: .reconnecting, message: "Showing last saved draft.")
    }
    .preferredColorScheme(.light)
}
#endif
