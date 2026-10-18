import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// Create a league (F-05, mockup V2CreateLeague). Presented as the one sheet
/// inside the `NavigationStack` that `ShellSheetView` provides.
///
/// Submission, reconciliation and the uncertain-outcome message live in
/// `CreateLeagueModel`; the form's values and limits in `CreateLeagueForm`.
struct CreateLeagueView: View {
    @Environment(ShellRouter.self) private var router

    @State private var model: CreateLeagueModel
    @State private var showsAdvanced = false
    @State private var confirmsDiscard = false
    @FocusState private var focusedField: Field?

    private enum Field { case name, team }

    init(lifecycle: any LeagueLifecycleRepository, directory: LeagueDirectoryStore) {
        _model = State(initialValue: CreateLeagueModel(lifecycle: lifecycle, directory: directory))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                if let result = model.completed, model.needsOpening {
                    // Saved on the server; only opening it failed. Retry re-reads, never re-sends.
                    InlineBanner(
                        tone: .info,
                        title: "Created \(result.leagueName). Open it from your leagues.",
                        actionTitle: model.isOpening ? "Retrying…" : "Retry",
                        action: { Task { @MainActor in await model.openCompleted() } }
                    )
                    .disabled(model.isOpening)
                }
                VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                    if let result = model.completed, let warning = result.warning {
                        InlineBanner(tone: .warning, title: "\(result.leagueName) was created", message: warning)
                    }
                    leagueGroup
                    rosterGroup
                    advancedToggle
                    if showsAdvanced {
                        advancedGroups
                    }
                    if let message = model.errorMessage {
                        InlineBanner(tone: .error, title: "Couldn't create the league", message: message)
                    }
                }
                .disabled(model.isRunning || model.completed != nil)
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("New League")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if model.completed != nil {
                // Created with a warning: the league is open behind the sheet.
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") { router.dismissSheet() }
                        .buttonStyle(.glassProminent)
                        .tint(Color.frGold)
                }
            } else {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") {
                        if model.isDirty {
                            confirmsDiscard = true
                        } else {
                            router.dismissSheet()
                        }
                    }
                    .disabled(model.isRunning)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create", systemImage: "checkmark", action: submit)
                        .buttonStyle(.glassProminent)
                        .tint(Color.frGold)
                        .disabled(model.form.trimmedName.isEmpty || model.isRunning)
                        .accessibilityValue(model.isRunning ? "Creating league" : "")
                }
            }
        }
        .confirmationDialog("Discard this league?", isPresented: $confirmsDiscard, titleVisibility: .visible) {
            Button("Discard", role: .destructive) { router.dismissSheet() }
            Button("Keep Editing", role: .cancel) {}
        } message: {
            Text("Nothing has been created yet.")
        }
        .interactiveDismissDisabled(model.isDirty || model.isRunning)
        // A send in flight counts too: a link replacing the sheet mid-request
        // would hide its outcome.
        .onChange(of: model.isDirty || model.isRunning, initial: true) { _, dirty in
            router.sheetHasUnsavedInput = dirty
        }
        .onChange(of: model.form) { old, _ in
            model.formDidChange(from: old)
        }
        .announcesError(model.errorMessage)
    }

    // MARK: Sections

    private var leagueGroup: some View {
        VStack(alignment: .leading, spacing: 8) {
            FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                FormFieldRow(label: "League", labelWidth: 100) {
                    TextField("Required", text: $model.form.name)
                        .textInputAutocapitalization(.words)
                        .submitLabel(.next)
                        .focused($focusedField, equals: .name)
                        .onSubmit { focusedField = .team }
                        .accessibilityLabel("League name")
                }
                FormFieldRow(label: "Your team", labelWidth: 100) {
                    TextField("Optional", text: $model.form.teamName)
                        .textInputAutocapitalization(.words)
                        .submitLabel(.done)
                        .focused($focusedField, equals: .team)
                        .accessibilityLabel("Your team name")
                        .accessibilityHint("Optional. Leave blank to use one based on your name.")
                }
                CreateLeagueStepperRow(
                    title: "Max players",
                    value: $model.form.maxParticipants,
                    range: CreateLeagueForm.participantRange
                )
                CreateLeagueToggleRow(title: "Invite only", isOn: $model.form.inviteOnly)
            }
            FRFootnote("Players join with your code, link or an email invite.")
        }
    }

    private var rosterGroup: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("Roster")
            FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                CreateLeagueStepperRow(
                    title: "Roster slots",
                    value: $model.form.totalSlots,
                    range: CreateLeagueForm.totalSlotRange
                )
                CreateLeagueStepperRow(
                    title: "Draft slots",
                    value: $model.form.draftSlots,
                    range: model.form.draftSlotRange
                )
                CreateLeagueStepperRow(
                    title: "Drops per season",
                    value: $model.form.dropLimit,
                    range: CreateLeagueForm.dropLimitRange
                )
            }
            FRFootnote(rosterFootnote)
        }
    }

    private var rosterFootnote: String {
        let form = model.form
        let draft = form.draftSlots == 1 ? "1 draft slot" : "\(form.draftSlots) draft slots"
        let open = form.openSlotsAfterDraft == 1 ? "1 open" : "\(form.openSlotsAfterDraft) open"
        return "Drafted movies and pickups share these slots. Draft slots set how many arrive in the draft: \(draft), \(open) after the draft."
    }

    private var advancedToggle: some View {
        Button {
            withAnimation(.snappy(duration: 0.25)) { showsAdvanced.toggle() }
        } label: {
            HStack(spacing: 6) {
                Text("Advanced")
                    .frFont(.sectionTitle)
                    .foregroundStyle(Color.frText)
                Image(systemName: "chevron.down")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(Color.frGold)
                    .rotationEffect(.degrees(showsAdvanced ? 180 : 0))
                    .accessibilityHidden(true)
                Spacer(minLength: 0)
            }
            .frame(minHeight: FRMetrics.minTapTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 4)
        .padding(.top, 8)
        .accessibilityLabel("Advanced options")
        .accessibilityValue(showsAdvanced ? "Expanded" : "Collapsed")
        .accessibilityAddTraits(.isHeader)
    }

    private var advancedGroups: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                CreateLeagueSubheader(title: "Bidding")
                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    CreateLeagueStepperRow(
                        title: "Counter window",
                        subtitle: "Time to answer a higher bid",
                        value: $model.form.counterbidHours,
                        range: CreateLeagueForm.counterbidHourRange,
                        display: { "\($0)h" },
                        spoken: { $0 == 1 ? "1 hour" : "\($0) hours" }
                    )
                    CreateLeagueStepperRow(
                        title: "New-bid cutoff",
                        subtitle: "Hours before processing",
                        value: $model.form.newBidCutoffHours,
                        range: CreateLeagueForm.newBidCutoffRange,
                        display: { $0 == 0 ? "Off" : "\($0)h" },
                        spoken: { (hours: Int) -> String in
                            if hours == 0 { return "Off, new bids open all week" }
                            return hours == 1 ? "1 hour before processing" : "\(hours) hours before processing"
                        }
                    )
                }
                FRFootnote(
                    model.form.newBidCutoffHours == 0
                        ? "New bids stay open all week."
                        : "After the cutoff, only counters to existing bids."
                )
            }
            VStack(alignment: .leading, spacing: 8) {
                CreateLeagueSubheader(title: "Counterpicks")
                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    CreateLeagueStepperRow(
                        title: "Draft slots",
                        value: $model.form.draftCounterpickSlots,
                        range: CreateLeagueForm.draftCounterpickRange,
                        spokenTitle: "Draft counterpick slots"
                    )
                    CreateLeagueStepperRow(
                        title: "Bidding slots",
                        value: $model.form.biddingCounterpickSlots,
                        range: CreateLeagueForm.biddingCounterpickRange,
                        spokenTitle: "Bidding counterpick slots"
                    )
                    CreateLeagueToggleRow(title: "Block drops", isOn: $model.form.counterpicksBlockDrops)
                }
                FRFootnote(
                    "A counterpick scores the opposite of a rival's movie. With Block drops on, a movie with a pending counterpick bid can't be dropped."
                )
            }
        }
        .transition(.opacity)
    }

    // MARK: Submit

    private func submit() {
        guard !model.isRunning else { return }
        guard model.validate() else {
            if model.form.trimmedName.isEmpty { focusedField = .name }
            return
        }
        focusedField = nil
        Task {
            // With a warning, or when the league couldn't be opened yet, the
            // sheet stays open to show it, with Done.
            if let result = await model.submit(), result.warning == nil, !model.needsOpening {
                router.dismissSheet()
            }
        }
    }
}

// MARK: - Form rows

/// A setting with a native stepper (`.gstep`): the title (and an optional
/// second line), the current value in numerals, then − / +. VoiceOver hears
/// one adjustable element: "Roster slots, 8".
private struct CreateLeagueStepperRow: View {
    let title: String
    var subtitle: String?
    @Binding var value: Int
    let range: ClosedRange<Int>
    var display: (Int) -> String = { String($0) }
    var spoken: ((Int) -> String)?
    var spokenTitle: String?

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        // At accessibility sizes the title stacks above the value and
        // stepper instead of squeezing them (as `FormFieldRow` does).
        let stacked = dynamicTypeSize.isAccessibilitySize
        let layout = stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(spacing: 12))
        layout {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .frFont(.input)
                    .foregroundStyle(Color.frText)
                if let subtitle {
                    Text(subtitle)
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityHidden(true)

            HStack(spacing: 12) {
                Text(display(value))
                    .frFont(.number)
                    .foregroundStyle(Color.frText)
                    .monospacedDigit()
                    .accessibilityHidden(true)

                Stepper(value: $value, in: range) {
                    Text(spokenTitle ?? title)
                }
                .labelsHidden()
                .accessibilityValue(spoken?(value) ?? display(value))
                .accessibilityHint(subtitle ?? "")
            }
        }
        .padding(.horizontal, FRMetrics.rowPadding)
        .padding(.vertical, stacked ? 10 : 6)
        .frame(minHeight: subtitle == nil ? 50 : 60)
    }
}

/// A switch row (`.toggle`).
private struct CreateLeagueToggleRow: View {
    let title: String
    @Binding var isOn: Bool

    var body: some View {
        Toggle(isOn: $isOn) {
            Text(title)
                .frFont(.input)
                .foregroundStyle(Color.frText)
        }
        .padding(.horizontal, FRMetrics.rowPadding)
        .padding(.vertical, 6)
        .frame(minHeight: 50)
    }
}

/// The `.gsub` label above an advanced group.
private struct CreateLeagueSubheader: View {
    let title: String

    var body: some View {
        Text(title)
            .frFont(.overline)
            .foregroundStyle(Color.frTextSecondary)
            .padding(.horizontal, 16)
            .accessibilityAddTraits(.isHeader)
    }
}

#if DEBUG
#Preview("Create league") {
    let environment = AppEnvironment.preview()
    let directory = LeagueDirectoryStore(userID: "preview-user", repository: environment.leagues)
    NavigationStack { CreateLeagueView(lifecycle: environment.leagueLifecycle, directory: directory) }
        .environment(environment)
        .environment(environment.session)
        .environment(ShellRouter())
        .environment(directory)
}
#endif
