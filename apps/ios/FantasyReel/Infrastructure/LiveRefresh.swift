import SwiftUI

/// Foreground and periodic refresh, the native side of the web's focus/online
/// revalidation (N-05). iOS suspends sockets in the background, so any screen
/// fed by Realtime also refreshes when the app becomes active again.
extension View {
    /// Runs `action` each time the app comes back from the background (not on
    /// first appearance, and not for brief interruptions such as Control Center
    /// or a Face ID prompt, which only make the scene inactive).
    func refreshOnForeground(_ action: @escaping @MainActor () async -> Void) -> some View {
        modifier(ForegroundRefreshModifier(action: action))
    }

    /// Runs `action` every `interval` while the scene is active and the view is
    /// on screen. Stops in the background and resumes on return. Use for the
    /// draft's 5 s/10 s reconciliation, not as a substitute for Realtime.
    func refreshPeriodically(every interval: Duration, _ action: @escaping @MainActor () async -> Void) -> some View {
        modifier(PeriodicRefreshModifier(interval: interval, action: action))
    }
}

private struct ForegroundRefreshModifier: ViewModifier {
    let action: @MainActor () async -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var wasBackgrounded = false

    func body(content: Content) -> some View {
        content.onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .background:
                wasBackgrounded = true
            case .active where wasBackgrounded:
                wasBackgrounded = false
                Task { await action() }
            default:
                break
            }
        }
    }
}

private struct PeriodicRefreshModifier: ViewModifier {
    let interval: Duration
    let action: @MainActor () async -> Void
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content.task(id: scenePhase == .active) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: interval)
                } catch {
                    return
                }
                await action()
            }
        }
    }
}

/// Spoken status updates for VoiceOver (the web's `announce()`), for changes a
/// sighted user sees but focus doesn't move to: a pick saved, a bid placed.
enum Announcer {
    @MainActor
    static func announce(_ message: String) {
        AccessibilityNotification.Announcement(message).post()
    }
}
