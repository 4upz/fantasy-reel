import SwiftUI

// Building blocks shared by the settings sections: a section with its header,
// rows, footer, inline error and Save button; read-only and locked rows;
// toggles, steppers and number fields sized for 44pt targets and Dynamic Type.

/// A section's Save button: enabled only with valid, changed input.
struct SettingsSaveButton {
    let title: String
    let isEnabled: Bool
    let isRunning: Bool
    let action: () -> Void

    init(title: String = "Save Changes", isEnabled: Bool, isRunning: Bool, action: @escaping () -> Void) {
        self.title = title
        self.isEnabled = isEnabled
        self.isRunning = isRunning
        self.action = action
    }
}

/// One settings section: `SectionHeader`, a plain-inset row group, an optional
/// footer (help or the lock explanation), the section's inline error, and an
/// optional Save button.
struct SettingsSection<Rows: View, Footer: View>: View {
    private let title: String
    private let error: String?
    private let save: SettingsSaveButton?
    private let rows: Rows
    private let footer: Footer

    init(
        _ title: String,
        error: String? = nil,
        save: SettingsSaveButton? = nil,
        @ViewBuilder rows: () -> Rows,
        @ViewBuilder footer: () -> Footer
    ) {
        self.title = title
        self.error = error
        self.save = save
        self.rows = rows()
        self.footer = footer()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title)
                .padding(.bottom, 4)
            FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                rows
            }
            footer
                .padding(.horizontal, 4)
            if let error {
                InlineBanner(tone: .error, title: error)
            }
            if let save {
                HStack {
                    Spacer(minLength: 0)
                    Button(action: save.action) {
                        Text(save.isRunning ? "Saving…" : save.title)
                    }
                    .buttonStyle(.fr(.primary, size: .medium, isLoading: save.isRunning))
                    .disabled(!save.isEnabled || save.isRunning)
                }
            }
        }
        .announcesError(error)
    }
}

extension SettingsSection where Footer == EmptyView {
    init(
        _ title: String,
        error: String? = nil,
        save: SettingsSaveButton? = nil,
        @ViewBuilder rows: () -> Rows
    ) {
        self.init(title, error: error, save: save, rows: rows) { EmptyView() }
    }
}

/// Footer text under a section's rows.
struct SettingsFootnote: View {
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
    }
}

/// Why a setting can't change right now: a lock and the web's sentence.
struct SettingsLockNote: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: "lock.fill")
                .font(.caption)
                .foregroundStyle(Color.frTextSecondary)
                .accessibilityHidden(true)
            Text(text)
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Locked. \(text)")
    }
}

/// A validation message under a field, in words (not just a red border).
struct SettingsFieldError: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Label {
            Text(text)
                .frFont(.meta)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.caption)
        }
        .foregroundStyle(Color.frError)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A read-only row: label and current value, with a lock when it can't change.
struct SettingsValueRow: View {
    private let label: String
    private let value: String
    private let isLocked: Bool

    init(_ label: String, value: String, isLocked: Bool = false) {
        self.label = label
        self.value = value
        self.isLocked = isLocked
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                labelText
                Spacer(minLength: 8)
                valueText
            }
            VStack(alignment: .leading, spacing: 4) {
                labelText
                valueText
            }
        }
        .padding(.horizontal, FRMetrics.rowPadding)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityValue(isLocked ? "Locked" : "")
    }

    private var labelText: some View {
        Text(label)
            .frFont(.rowLabel)
            .foregroundStyle(Color.frText)
    }

    private var valueText: some View {
        HStack(spacing: 6) {
            Text(value)
                .frFont(.input)
                .foregroundStyle(Color.frTextSecondary)
                .multilineTextAlignment(.trailing)
            if isLocked {
                Image(systemName: "lock.fill")
                    .font(.caption)
                    .foregroundStyle(Color.frTextMuted)
                    .accessibilityHidden(true)
            }
        }
    }
}

/// A switch row with an optional description that follows its state.
struct SettingsToggleRow: View {
    private let title: String
    private let detail: String?
    @Binding private var isOn: Bool

    init(_ title: String, detail: String? = nil, isOn: Binding<Bool>) {
        self.title = title
        self.detail = detail
        self._isOn = isOn
    }

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .frFont(.rowLabel)
                    .foregroundStyle(Color.frText)
                if let detail {
                    Text(detail)
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .tint(Color.frGold)
        .padding(.horizontal, FRMetrics.rowPadding)
        .padding(.vertical, 10)
        .frame(minHeight: 50)
    }
}

/// A stepper row for a small count: label, the value in words, − / +.
struct SettingsStepperRow: View {
    private let title: String
    private let valueText: String
    private let range: ClosedRange<Int>
    @Binding private var value: Int

    init(_ title: String, value: Binding<Int>, in range: ClosedRange<Int>, valueText: String? = nil) {
        self.title = title
        self._value = value
        self.range = range
        self.valueText = valueText ?? "\(value.wrappedValue)"
    }

    var body: some View {
        Stepper(value: $value, in: range) {
            HStack(spacing: 8) {
                Text(title)
                    .frFont(.rowLabel)
                    .foregroundStyle(Color.frText)
                Spacer(minLength: 4)
                Text(valueText)
                    .frFont(.number)
                    .foregroundStyle(Color.frText)
                    .accessibilityHidden(true)
            }
        }
        .accessibilityValue(valueText)
        .padding(.horizontal, FRMetrics.rowPadding)
        .padding(.vertical, 6)
        .frame(minHeight: 50)
    }
}

/// A whole-number field with a unit ("hours"). Held as text so an empty field
/// can mean "app default" and a half-typed value isn't rewritten.
struct SettingsNumberFieldRow: View {
    private let title: String
    private let unit: String
    private let placeholder: String
    @Binding private var text: String

    init(_ title: String, text: Binding<String>, unit: String, placeholder: String = "") {
        self.title = title
        self._text = text
        self.unit = unit
        self.placeholder = placeholder
    }

    var body: some View {
        FormFieldRow(label: title, labelWidth: 150) {
            HStack(spacing: 8) {
                TextField(placeholder, text: $text)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .accessibilityLabel("\(title), \(unit)")
                Text(unit)
                    .frFont(.label)
                    .foregroundStyle(Color.frTextSecondary)
                    .accessibilityHidden(true)
            }
        }
    }
}

/// A date-only picker row. The picker shows the UTC calendar, so the day
/// picked is the day sent (never shifted by the device's time zone).
struct SettingsDateRow: View {
    private let title: String
    private let range: PartialRangeFrom<Date>?
    private let upperRange: PartialRangeThrough<Date>?
    @Binding private var date: DateOnly

    init(_ title: String, date: Binding<DateOnly>, from lowerBound: DateOnly? = nil) {
        self.title = title
        self._date = date
        self.range = lowerBound.map { $0.pickerDate... }
        self.upperRange = nil
    }

    init(_ title: String, date: Binding<DateOnly>, through upperBound: DateOnly) {
        self.title = title
        self._date = date
        self.range = nil
        self.upperRange = ...upperBound.pickerDate
    }

    private var binding: Binding<Date> {
        Binding(
            get: { date.pickerDate },
            set: { date = DateOnly.fromPicker($0) }
        )
    }

    var body: some View {
        Group {
            if let range {
                DatePicker(title, selection: binding, in: range, displayedComponents: .date)
            } else if let upperRange {
                DatePicker(title, selection: binding, in: upperRange, displayedComponents: .date)
            } else {
                DatePicker(title, selection: binding, displayedComponents: .date)
            }
        }
        .frFont(.rowLabel)
        .foregroundStyle(Color.frText)
        .tint(Color.frGold)
        .environment(\.timeZone, .gmt)
        .padding(.horizontal, FRMetrics.rowPadding)
        .padding(.vertical, 6)
        .frame(minHeight: 50)
    }
}

/// A full-width row that acts (opens a screen, switches tabs): label, optional
/// detail, chevron.
struct SettingsActionRow: View {
    private let title: String
    private let detail: String?
    private let tone: Color
    private let action: () -> Void

    init(_ title: String, detail: String? = nil, tone: Color = .frText, action: @escaping () -> Void) {
        self.title = title
        self.detail = detail
        self.tone = tone
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .frFont(.rowTitle)
                        .foregroundStyle(tone)
                    if let detail {
                        Text(detail)
                            .frFont(.meta)
                            .foregroundStyle(Color.frTextSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                RowChevron()
            }
            .padding(.horizontal, FRMetrics.rowPadding)
            .padding(.vertical, 10)
            .frame(minHeight: 50)
        }
        .buttonStyle(.frRow)
    }
}
