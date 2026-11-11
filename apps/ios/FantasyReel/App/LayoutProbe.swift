#if DEBUG
import Foundation
import SwiftUI

extension View {
    /// Debug builds launched with `FR_LAYOUT_PROBE=1` print the window's size,
    /// safe area, size classes and vertical-bar edge every time they change,
    /// one line each, to stdout. This is how the iPhone Duo measurements in
    /// `docs/IOS-DUO-PLAN.md` were taken:
    ///
    ///     SIMCTL_CHILD_FR_LAYOUT_PROBE=1 xcrun simctl launch --console <udid> com.fantasyreel.ios
    ///
    /// Then open, close or rotate the device and read the log.
    func layoutProbe() -> some View {
        modifier(LayoutProbe())
    }
}

private struct LayoutProbe: ViewModifier {
    private static let isEnabled = ProcessInfo.processInfo.environment["FR_LAYOUT_PROBE"] == "1"

    @Environment(\.horizontalSizeClass) private var horizontal
    @Environment(\.verticalSizeClass) private var vertical

    func body(content: Content) -> some View {
        if Self.isEnabled {
            content.background {
                GeometryReader { proxy in
                    Color.clear
                        .onChange(of: line(proxy), initial: true) { _, line in print(line) }
                }
            }
        } else {
            content
        }
    }

    private func line(_ proxy: GeometryProxy) -> String {
        let size = proxy.size
        let inset = proxy.safeAreaInsets
        func name(_ sizeClass: UserInterfaceSizeClass?) -> String {
            switch sizeClass {
            case .compact: "compact"
            case .regular: "regular"
            default: "unknown"
            }
        }
        return "[layout] safe content \(Int(size.width))×\(Int(size.height)) pt; "
            + "insets top \(inset.top) leading \(inset.leading) bottom \(inset.bottom) trailing \(inset.trailing); "
            + "full \(Int(size.width + inset.leading + inset.trailing))×\(Int(size.height + inset.top + inset.bottom)) pt; "
            + "size class \(name(horizontal)) width, \(name(vertical)) height"
    }
}
#endif
