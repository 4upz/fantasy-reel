import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// The create-league form's values. Defaults and limits are `create-league`'s
/// (and the web's `CreateLeagueModal`); the server stays authoritative.
struct CreateLeagueForm: Equatable {
    static let participantRange = 2...20
    static let totalSlotRange = 1...20
    static let minDraftSlots = 1
    static let dropLimitRange = 0...10
    static let counterbidHourRange = 1...72
    /// 0 turns the cutoff off (new bids stay open all week).
    static let newBidCutoffRange = 0...144
    static let draftCounterpickRange = 0...5
    static let biddingCounterpickRange = 0...3

    var name = ""
    var teamName = ""
    var maxParticipants = 8
    var inviteOnly = false
    var totalSlots = 8
    var draftSlots = 5
    var dropLimit = 2
    var counterbidHours = 24
    var newBidCutoffHours = 48
    var draftCounterpickSlots = 1
    var biddingCounterpickSlots = 0
    var counterpicksBlockDrops = true

    var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    var trimmedTeamName: String { teamName.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// The draft slots range for the current roster size.
    var draftSlotRange: ClosedRange<Int> { Self.minDraftSlots...max(Self.minDraftSlots, totalSlots) }

    /// Slots left for pickups after the draft.
    var openSlotsAfterDraft: Int { max(0, totalSlots - draftSlots) }

    /// The first problem that would make `create-league` refuse the form.
    var validationMessage: String? {
        if trimmedName.isEmpty { return "Please enter a league name" }
        if trimmedName.count > CreateLeagueRequest.maxNameLength {
            return "League name can be at most \(CreateLeagueRequest.maxNameLength) characters"
        }
        if trimmedTeamName.count > CreateLeagueRequest.maxTeamNameLength {
            return "Team name can be at most \(CreateLeagueRequest.maxTeamNameLength) characters"
        }
        if draftSlots > totalSlots { return "Draft slots cannot exceed total slots" }
        return nil
    }

    var request: CreateLeagueRequest {
        CreateLeagueRequest(
            name: trimmedName,
            teamName: trimmedTeamName.isEmpty ? nil : trimmedTeamName,
            inviteOnly: inviteOnly,
            maxParticipants: maxParticipants,
            totalSlots: totalSlots,
            draftSlots: min(draftSlots, totalSlots),
            dropLimit: dropLimit,
            counterbidHours: counterbidHours,
            newBidCutoffHours: newBidCutoffHours,
            draftCounterpickSlots: draftCounterpickSlots,
            biddingCounterpickSlots: biddingCounterpickSlots,
            counterpicksBlockDrops: counterpicksBlockDrops
        )
    }
}

/// Create a league (F-05, mockup V2CreateLeague). Presented as the one sheet
/// inside the `NavigationStack` that `ShellSheetView` provides.
///
/// `create-league` is never retried: a success with a `warning` still opens
/// the new league, and an uncertain failure re-reads the directory and asks the
/// person to check their leagues before trying again.
struct CreateLeagueView: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(ShellRouter.self) private var router
    @Environment(LeagueDirectoryStore.self) private var directory

    @State private var form = CreateLeagueForm()
    @State private var showsAdvanced = false
    @State private var create = AsyncAction()
    @State private var localError: String?
    @State private var outcomeUncertain = false
    @State private var confirmsDiscard = false
    @FocusState private var focusedField: Field?

    private enum Field { case name, team }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                leagueGroup
                rosterGroup
                advancedToggle
                if showsAdvanced {
                    advancedGroups
                }
                if let message = errorMessage {
                    InlineBanner(tone: .error, title: "Couldn't create the league", message: message)
                }
            }
            .disabled(create.isRunning)
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("New League")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") {
                    if isDirty {
                        confirmsDiscard = true
                    } else {
                        router.dismissSheet()
                    }
                }
                .disabled(create.isRunning)
            }
            ToolbarItem(placement: .confirmationAction) {
                if create.isRunning {
                    ProgressView()
                        .accessibilityLabel("Creating league")
                } else {
                    Button("Create", action: submit)
                        .disabled(form.trimmedName.isEmpty)
                }
            }
        }
        .confirmationDialog("Discard this league?", isPresented: $confirmsDiscard, titleVisibility: .visible) {
            Button("Discard", role: .destructive) { router.dismissSheet() }
            Button("Keep Editing", role: .cancel) {}
        } message: {
            Text("Nothing has been created yet.")
        }
        .interactiveDismissDisabled(isDirty || create.isRunning)
        .onChange(of: isDirty, initial: true) { _, dirty in
            router.sheetHasUnsavedInput = dirty
        }
        .onChange(of: form.totalSlots) { _, total in
            // Lowering the roster lowers the draft to match, as on the web.
            if form.draftSlots > total { form.draftSlots = total }
        }
        .onChange(of: form.name) { _, name in
            if name.count > CreateLeagueRequest.maxNameLength {
                form.name = String(name.prefix(CreateLeagueRequest.maxNameLength))
            }
            localError = nil
        }
        .onChange(of: form.teamName) { _, team in
            if team.count > CreateLeagueRequest.maxTeamNameLength {
                form.teamName = String(team.prefix(CreateLeagueRequest.maxTeamNameLength))
            }
        }
        .announcesError(errorMessage)
    }

    // MARK: Sections

    private var leagueGroup: some View {
        VStack(alignment: .leading, spacing: 8) {
            FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                FormFieldRow(label: "League", labelWidth: 100) {
                    TextField("Required", text: $form.name)
                        .textInputAutocapitalization(.words)
                        .submitLabel(.next)
                        .focused($focusedField, equals: .name)
                        .onSubmit { focusedField = .team }
                        .accessibilityLabel("League name")
                }
                FormFieldRow(label: "Your team", labelWidth: 100) {
                    TextField("Optional", text: $form.teamName)
                        .textInputAutocapitalization(.words)
                        .submitLabel(.done)
                        .focused($focusedField, equals: .team)
                        .accessibilityLabel("Your team name")
                        .accessibilityHint("Optional. Leave blank to use one based on your name.")
                }
                CreateLeagueStepperRow(
                    title: "Max players",
                    value: $form.maxParticipants,
                    range: CreateLeagueForm.participantRange
                )
                CreateLeagueToggleRow(title: "Invite only", isOn: $form.inviteOnly)
            }
            CreateLeagueFootnote(text: "Players join with your code, link or an email invite.")
        }
    }

    private var rosterGroup: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("Roster")
            FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                CreateLeagueStepperRow(
                    title: "Roster slots",
                    value: $form.totalSlots,
                    range: CreateLeagueForm.totalSlotRange
                )
                CreateLeagueStepperRow(
                    title: "Draft slots",
                    value: $form.draftSlots,
                    range: form.draftSlotRange
                )
                CreateLeagueStepperRow(
                    title: "Drops per season",
                    value: $form.dropLimit,
                    range: CreateLeagueForm.dropLimitRange
                )
            }
            CreateLeagueFootnote(text: rosterFootnote)
        }
    }

    private var rosterFootnote: String {
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
                        value: $form.counterbidHours,
                        range: CreateLeagueForm.counterbidHourRange,
                        display: { "\($0)h" },
                        spoken: { $0 == 1 ? "1 hour" : "\($0) hours" }
                    )
                    CreateLeagueStepperRow(
                        title: "New-bid cutoff",
                        subtitle: "Hours before processing",
                        value: $form.newBidCutoffHours,
                        range: CreateLeagueForm.newBidCutoffRange,
                        display: { $0 == 0 ? "Off" : "\($0)h" },
                        spoken: { (hours: Int) -> String in
                            if hours == 0 { return "Off, new bids open all week" }
                            return hours == 1 ? "1 hour before processing" : "\(hours) hours before processing"
                        }
                    )
                }
                CreateLeagueFootnote(
                    text: form.newBidCutoffHours == 0
                        ? "New bids stay open all week."
                        : "After the cutoff, only counters to existing bids."
                )
            }
            VStack(alignment: .leading, spacing: 8) {
                CreateLeagueSubheader(title: "Counterpicks")
                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    CreateLeagueStepperRow(
                        title: "Draft slots",
                        value: $form.draftCounterpickSlots,
                        range: CreateLeagueForm.draftCounterpickRange,
                        spokenTitle: "Draft counterpick slots"
                    )
                    CreateLeagueStepperRow(
                        title: "Bidding slots",
                        value: $form.biddingCounterpickSlots,
                        range: CreateLeagueForm.biddingCounterpickRange,
                        spokenTitle: "Bidding counterpick slots"
                    )
                    CreateLeagueToggleRow(title: "Block drops", isOn: $form.counterpicksBlockDrops)
                }
                CreateLeagueFootnote(
                    text: "A counterpick scores the opposite of a rival's movie. With Block drops on, a movie with a pending counterpick bid can't be dropped."
                )
            }
        }
        .transition(.opacity)
    }

    // MARK: Submit

    private var isDirty: Bool { form != CreateLeagueForm() }

    private var errorMessage: String? {
        if let localError { return localError }
        if outcomeUncertain {
            return "We couldn't confirm the league was created. Check your league list before trying again."
        }
        return create.errorMessage
    }

    private func submit() {
        guard !create.isRunning else { return }
        localError = nil
        outcomeUncertain = false
        if let problem = form.validationMessage {
            localError = problem
            if form.trimmedName.isEmpty { focusedField = .name }
            return
        }
        focusedField = nil
        let request = form.request
        let lifecycle = environment.leagueLifecycle
        Task {
            let succeeded = await create.runAndWait {
                let result = try await lifecycle.createLeague(request)
                // A `warning` means the league exists but the team step failed;
                // open it anyway (the home screen offers recovery) and never
                // create a second one.
                await directory.refresh()
                directory.select(result.leagueID)
                Announcer.announce("\(result.leagueName) created")
                router.dismissSheet()
            }
            if !succeeded, create.lastError?.isUncertainOutcome == true {
                // The league may exist: show it in the menu before anyone retries.
                await directory.refresh()
                outcomeUncertain = true
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
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .frFont(.input)
                    .foregroundStyle(Color.frText)
                if let subtitle {
                    Text(subtitle)
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityHidden(true)

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
        .padding(.horizontal, FRMetrics.rowPadding)
        .padding(.vertical, 6)
        .frame(minHeight: subtitle == nil ? 50 : 60)
    }
}

/// A switch row (`.toggle`) in the form's gold.
private struct CreateLeagueToggleRow: View {
    let title: String
    @Binding var isOn: Bool

    var body: some View {
        Toggle(isOn: $isOn) {
            Text(title)
                .frFont(.input)
                .foregroundStyle(Color.frText)
        }
        .tint(Color.frGold)
        .padding(.horizontal, FRMetrics.rowPadding)
        .padding(.vertical, 6)
        .frame(minHeight: 50)
    }
}

/// The `.foot` note under a group.
private struct CreateLeagueFootnote: View {
    let text: String

    var body: some View {
        Text(text)
            .frFont(.meta)
            .foregroundStyle(Color.frTextSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 16)
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
    NavigationStack { CreateLeagueView() }
        .environment(environment)
        .environment(environment.session)
        .environment(ShellRouter())
        .environment(LeagueDirectoryStore(userID: "preview-user", repository: environment.leagues))
}
#endif
