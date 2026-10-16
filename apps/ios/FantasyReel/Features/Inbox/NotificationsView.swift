import SwiftUI

/// The notification inbox: latest 50, mark read, route to the right screen (F-17).
/// Read and mark through `InboxStore` so the bell badge stays in sync.
struct NotificationsView: View {
    var body: some View {
        FeaturePlaceholderView(title: "Notifications", requirements: "F-17", systemImage: "bell", showsHeader: false)
    }
}
