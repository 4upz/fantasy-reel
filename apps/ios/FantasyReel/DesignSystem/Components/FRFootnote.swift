import SwiftUI

/// The `.foot` note under a row group or form: secondary meta text, wrapping,
/// inset 16pt so it lines up with the rows' content above it.
///
/// ```swift
/// FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) { … }
/// FRFootnote("Players join with your code, link or an email invite.")
/// ```
struct FRFootnote: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .frFont(.meta)
            .foregroundStyle(Color.frTextSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, FRMetrics.rowPadding)
    }
}

#if DEBUG
#Preview("Footnote") {
    FRPreviewCanvas {
        FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
            FormFieldRow(label: "League") { Text("Popcorn Syndicate") }
        }
        FRFootnote("Players join with your code, link or an email invite.")
    }
}
#endif
