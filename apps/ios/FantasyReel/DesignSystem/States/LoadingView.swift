import SwiftUI

/// A centered spinner with a visible label ("Loading roster…"), filling the
/// space it is given. The label is also what VoiceOver reads.
struct LoadingView: View {
    private let label: String

    init(label: String = "Loading…") {
        self.label = label
    }

    var body: some View {
        ProgressView {
            Text(label)
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
        }
        .tint(Color.frTextSecondary)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, 32)
    }
}

#if DEBUG
#Preview("Loading") {
    LoadingView(label: "Loading roster…")
        .background(Color.frBackground)
}
#endif
