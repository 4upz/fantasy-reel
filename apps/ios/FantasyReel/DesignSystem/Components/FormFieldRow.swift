import SwiftUI

/// One row of a grouped form (`.fgrp .field`): a fixed label column (92pt by
/// default, as on V2LogIn; pass a wider `labelWidth` for long labels) and the
/// control, at least 50pt tall. At accessibility text sizes the label
/// stacks above the control instead of squeezing it.
///
/// Put rows in `FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset)`.
/// Keep real fields native and set their content type at the call site:
///
/// ```swift
/// FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
///     FormFieldRow(label: "Email") {
///         TextField("you@example.com", text: $email)
///             .textContentType(.emailAddress)
///             .keyboardType(.emailAddress)
///             .textInputAutocapitalization(.never)
///     }
///     FormFieldRow(label: "Password") {
///         SecureField("Required", text: $password).textContentType(.password)
///     }
/// }
/// ```
struct FormFieldRow<Content: View>: View {
    private let label: String
    private let labelWidth: CGFloat
    private let content: Content

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    init(label: String, labelWidth: CGFloat = 92, @ViewBuilder content: () -> Content) {
        self.label = label
        self.labelWidth = labelWidth
        self.content = content()
    }

    var body: some View {
        let stacked = dynamicTypeSize.isAccessibilitySize
        let layout = stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
        layout {
            Text(label)
                .frFont(.input)
                .foregroundStyle(Color.frText)
                .frame(width: stacked ? nil : labelWidth, alignment: .leading)
            content
                .frFont(.input)
                .foregroundStyle(Color.frText)
                .tint(Color.frGold)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, FRMetrics.rowPadding)
        .padding(.vertical, stacked ? 10 : 4)
        .frame(minHeight: 50)
    }
}

#if DEBUG
#Preview("Form rows") {
    @Previewable @State var name = "Popcorn Syndicate"
    @Previewable @State var code = ""
    FRPreviewCanvas {
        FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
            FormFieldRow(label: "League name", labelWidth: 120) {
                TextField("Required", text: $name)
            }
            FormFieldRow(label: "Join code", labelWidth: 120) {
                TextField("ABC123", text: $code)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
            }
        }
    }
}

#Preview("Form rows · light AX") {
    @Previewable @State var email = ""
    FRPreviewCanvas {
        FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
            FormFieldRow(label: "Email") {
                TextField("you@example.com", text: $email).textContentType(.emailAddress)
            }
        }
    }
    .preferredColorScheme(.light)
    .environment(\.dynamicTypeSize, .accessibility2)
}
#endif
