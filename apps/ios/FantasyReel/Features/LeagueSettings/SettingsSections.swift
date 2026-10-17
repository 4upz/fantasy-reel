import FantasyReelAPI
import FantasyReelCore
import SwiftUI

// The configuration sections of owner settings (F-15). Each section keeps its
// own draft of the values, validates them with the web's wording, and saves
// through one `update-league` action. When the server's value changes (after
// a save here, or from another device) the draft follows it.

// MARK: - General

struct SettingsGeneralSection: View {
    let season: League
    let model: SettingsModel

    @State private var name: String
    @State private var maxPlayers: Int

    init(season: League, model: SettingsModel) {
        self.season = season
        self.model = model
        _name = State(initialValue: season.name)
        _maxPlayers = State(initialValue: season.maxParticipants)
    }

    private var isSetup: Bool { season.status == .setup }

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// UTF-16 length, as the web and server count it.
    private var nameLength: Int { trimmedName.utf16.count }

    private var nameError: String? {
        if trimmedName.isEmpty { return "Enter a league name." }
        let over = nameLength - SettingsLimits.maxNameLength
        if over > 0 {
            return "The name is \(SettingsText.plural(over, "character", "characters")) too long."
        }
        return nil
    }

    private var maxPlayersError: String? {
        guard isSetup else { return nil }
        let range = SettingsLimits.participants
        if !range.contains(maxPlayers) {
            return "Must be between \(range.lowerBound) and \(range.upperBound)"
        }
        if let count = model.activeCount, maxPlayers < count {
            return "Cannot set below current participant count (\(count))"
        }
        return nil
    }

    private var updates: [LeagueUpdate] {
        var list: [LeagueUpdate] = []
        if trimmedName != season.name {
            list.append(.info(name: trimmedName))
        }
        if isSetup, maxPlayers != season.maxParticipants {
            list.append(.participantLimit(maxPlayers))
        }
        return list
    }

    private var canSave: Bool {
        !updates.isEmpty && nameError == nil && maxPlayersError == nil
    }

    var body: some View {
        SettingsSection(
            "General",
            error: model.general.errorMessage,
            save: SettingsSaveButton(isEnabled: canSave, isRunning: model.general.isRunning, action: save)
        ) {
            FormFieldRow(label: "Name", labelWidth: 110) {
                TextField("League name", text: $name)
                    .textInputAutocapitalization(.words)
                    .submitLabel(.done)
                    .disabled(model.general.isRunning)
            }
            if isSetup {
                SettingsStepperRow("Max players", value: $maxPlayers, in: SettingsLimits.participants)
                    .disabled(model.general.isRunning)
            } else {
                SettingsValueRow("Max players", value: "\(season.maxParticipants)", isLocked: true)
            }
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                if let nameError { SettingsFieldError(nameError) }
                if let maxPlayersError { SettingsFieldError(maxPlayersError) }
                FRFootnote(
                    "Renaming changes the league's name in every season. "
                        + "\(nameLength)/\(SettingsLimits.maxNameLength) characters."
                )
                if isSetup {
                    if let count = model.activeCount {
                        FRFootnote("Current participants: \(count) / \(season.maxParticipants)")
                    }
                } else {
                    SettingsLockNote(
                        "Draft configuration cannot be changed after the draft has started. "
                            + "Current limit: \(season.maxParticipants) participants"
                    )
                }
            }
        }
        .onChange(of: season.name) { _, new in name = new }
        .onChange(of: season.maxParticipants) { _, new in maxPlayers = new }
    }

    private func save() {
        guard canSave else { return }
        model.save(updates, with: model.general) {
            Announcer.announce("League info updated.")
        }
    }
}

// MARK: - Joining

/// Who may join (invite only) and the share code. The toggle saves through
/// `update_info`, like the web's general settings.
struct SettingsJoiningSection: View {
    let season: League
    let model: SettingsModel

    @State private var inviteOnly: Bool

    init(season: League, model: SettingsModel) {
        self.season = season
        self.model = model
        _inviteOnly = State(initialValue: season.inviteOnly)
    }

    private var hasChanges: Bool { inviteOnly != season.inviteOnly }

    var body: some View {
        VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            SettingsSection(
                "Joining",
                error: model.joining.errorMessage,
                save: SettingsSaveButton(isEnabled: hasChanges, isRunning: model.joining.isRunning, action: save)
            ) {
                SettingsToggleRow(
                    "Invite only",
                    detail: inviteOnly
                        ? "Only invited users can join this league"
                        : "Anyone with the link can join this league",
                    isOn: $inviteOnly
                )
                .disabled(model.joining.isRunning)
            }
            JoinCodeCard(season: season)
        }
        .onChange(of: season.inviteOnly) { _, new in inviteOnly = new }
    }

    private func save() {
        guard hasChanges else { return }
        model.save(.info(inviteOnly: inviteOnly), with: model.joining) {
            Announcer.announce("Joining settings updated.")
        }
    }
}

// MARK: - Season

struct SettingsSeasonSection: View {
    let season: League
    let model: SettingsModel

    @State private var year: Int
    @State private var end: DateOnly

    init(season: League, model: SettingsModel) {
        self.season = season
        self.model = model
        _year = State(initialValue: season.seasonYear)
        _end = State(initialValue: season.seasonEnd)
    }

    private var isSetup: Bool { season.status == .setup }
    private var isCompleted: Bool { season.status == .completed }
    private var thisYear: Int { DateOnly.today().year }

    private var yearOptions: [Int] {
        Array(Set([season.seasonYear, thisYear, thisYear + 1])).sorted()
    }

    private var yearChanged: Bool { isSetup && year != season.seasonYear }
    private var endChanged: Bool { end != season.seasonEnd }

    /// The end the server would store: the picked date, or Dec 31 of a new year
    /// when only the year changed.
    private var effectiveEnd: DateOnly {
        if endChanged { return end }
        if yearChanged, let december31 = DateOnly(year: year, month: 12, day: 31) { return december31 }
        return season.seasonEnd
    }

    private var validationError: String? {
        guard yearChanged || endChanged else { return nil }
        if yearChanged, year != thisYear, year != thisYear + 1 {
            return "Season year can only be this year or next year"
        }
        if effectiveEnd < DateOnly.today() {
            return "Season end must be today or later"
        }
        if let deadline = season.tradeDeadline, deadline > effectiveEnd {
            return "The trade deadline (\(deadline.formattedFull)) would fall after the season ends "
                + "(\(effectiveEnd.formattedFull)). Move the trade deadline first."
        }
        return nil
    }

    private var canSave: Bool {
        !isCompleted && (yearChanged || endChanged) && validationError == nil
    }

    var body: some View {
        SettingsSection(
            "Season",
            error: model.season.errorMessage,
            save: isCompleted
                ? nil
                : SettingsSaveButton(isEnabled: canSave, isRunning: model.season.isRunning, action: save)
        ) {
            if isSetup {
                FormFieldRow(label: "Season year", labelWidth: 110) {
                    FRSegmentedControl(
                        "Season year",
                        selection: $year,
                        options: yearOptions,
                        track: .elevated,
                        title: { String($0) }
                    )
                }
                .disabled(model.season.isRunning)
            } else {
                SettingsValueRow("Season year", value: String(season.seasonYear), isLocked: true)
            }
            if isCompleted {
                SettingsValueRow("Season ends", value: season.seasonEnd.formattedFull, isLocked: true)
            } else {
                // A stored end already in the past stays selectable as it is
                // (validation explains it) instead of being clamped to today.
                SettingsDateRow("Season ends", date: $end, from: min(season.seasonEnd, DateOnly.today()))
                    .disabled(model.season.isRunning)
            }
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                if let validationError { SettingsFieldError(validationError) }
                if isCompleted {
                    SettingsLockNote("This season is complete. Its dates and results are final.")
                } else {
                    if isSetup {
                        FRFootnote(
                            "Decides which movies are in play — anything released before this season is off "
                                + "the board. Creating this league for next year's movies? Pick \(thisYear + 1)."
                        )
                        if yearChanged, !endChanged {
                            FRFootnote("Changing only the year moves the season end to December 31, \(String(year)).")
                        }
                    } else {
                        SettingsLockNote("The season year is fixed once the draft starts.")
                    }
                    FRFootnote(endFootnote)
                }
            }
        }
        .onChange(of: season.seasonYear) { _, new in year = new }
        .onChange(of: season.seasonEnd) { _, new in end = new }
    }

    private var endFootnote: String {
        let freeze = "Scores freeze after this date and the champion is recorded."
        if let deadline = season.tradeDeadline {
            return freeze + " Trades close \(deadline.formattedFull)."
        }
        return freeze + " Trades run until then unless you set a deadline."
    }

    private func save() {
        guard canSave else { return }
        let update = LeagueUpdate.season(year: yearChanged ? year : nil, end: endChanged ? end : nil)
        model.save(update, with: model.season) {
            Announcer.announce("Season settings updated.")
        }
    }
}

// MARK: - Scoring

struct SettingsScoringSection: View {
    let season: League
    let model: SettingsModel

    @State private var doublePoints: Bool

    /// The Tomatometer the worked example uses: far enough above 90 to show the gap.
    private static let exampleRT = 96

    init(season: League, model: SettingsModel) {
        self.season = season
        self.model = model
        _doublePoints = State(initialValue: season.doublePointsOver90)
    }

    /// Open through the draft, then fixed for the season.
    private var isLocked: Bool {
        season.status != .setup && season.status != .drafting
    }

    private static func points(_ double: Bool) -> Double {
        FantasyPoints.fantasyPointsForTomatometer(Double(exampleRT), doublePointsOver90: double)
    }

    var body: some View {
        if isLocked {
            SettingsSection("Scoring") {
                SettingsValueRow(
                    "Double points above 90%",
                    value: season.doublePointsOver90 ? "On" : "Off",
                    isLocked: true
                )
            } footer: {
                SettingsLockNote(lockedScoringNote)
            }
        } else {
            SettingsSection(
                "Scoring",
                error: model.scoring.errorMessage,
                save: SettingsSaveButton(
                    isEnabled: doublePoints != season.doublePointsOver90,
                    isRunning: model.scoring.isRunning,
                    action: save
                )
            ) {
                SettingsToggleRow(
                    "Double points above 90%",
                    detail: doublePoints
                        ? "Each Tomatometer point above 90% earns 2 fantasy points instead of 1."
                        : "Each Tomatometer point above 90% earns 1 fantasy point, the same as below it.",
                    isOn: $doublePoints
                )
                .disabled(model.scoring.isRunning)
            } footer: {
                VStack(alignment: .leading, spacing: 6) {
                    FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                        SettingsExampleRow(
                            "A \(Self.exampleRT)% movie earns",
                            points: Self.points(doublePoints),
                            tone: .frGold
                        )
                        SettingsExampleRow(
                            "A counterpick on it scores",
                            points: -Self.points(doublePoints),
                            tone: .frCrimsonText
                        )
                    }
                    .padding(.bottom, 2)
                    FRFootnote(otherRuleNote)
                    FRFootnote("You can change this until the draft is over. After that it stays fixed for the season.")
                }
            }
            .onChange(of: season.doublePointsOver90) { _, new in doublePoints = new }
        }
    }

    private var otherRuleNote: String {
        let other = FantasyPoints.signed(Self.points(!doublePoints))
        let setting = doublePoints ? "off" : "on"
        return "It would earn \(other) with double points \(setting). A counterpick always loses whatever the movie earns."
    }

    private var lockedScoringNote: String {
        let rule = season.doublePointsOver90
            ? "double points above 90%"
            : "1 point per Tomatometer point above 90%"
        let earned = FantasyPoints.signed(Self.points(season.doublePointsOver90))
        return "Scoring locks once the draft is over, so the whole season plays under one rule. "
            + "This season uses \(rule): a \(Self.exampleRT)% movie earns \(earned)."
    }

    private func save() {
        guard doublePoints != season.doublePointsOver90 else { return }
        model.save(.scoring(doublePointsOver90: doublePoints), with: model.scoring) {
            Announcer.announce("Scoring updated.")
        }
    }
}

// MARK: - Roster & bidding

struct SettingsRosterSection: View {
    let season: League
    let model: SettingsModel

    @State private var totalSlots: Int
    @State private var draftSlots: Int
    @State private var dropLimit: Int
    @State private var counterbidText: String
    @State private var cutoffText: String

    init(season: League, model: SettingsModel) {
        self.season = season
        self.model = model
        _totalSlots = State(initialValue: season.totalSlots)
        _draftSlots = State(initialValue: season.draftSlots)
        _dropLimit = State(initialValue: season.dropLimit)
        _counterbidText = State(initialValue: String(season.counterbidHours))
        _cutoffText = State(initialValue: String(season.newBidCutoffHours))
    }

    private var isLocked: Bool { season.status != .setup }

    private var counterbidHours: Int? { SettingsText.integer(counterbidText) }
    private var cutoffHours: Int? { SettingsText.integer(cutoffText) }

    private var totalError: String? {
        let range = SettingsLimits.totalSlots
        return range.contains(totalSlots) ? nil : "Must be between \(range.lowerBound) and \(range.upperBound)"
    }

    private var draftError: String? {
        (SettingsLimits.minDraftSlots...max(SettingsLimits.minDraftSlots, totalSlots)).contains(draftSlots)
            ? nil
            : "Must be between \(SettingsLimits.minDraftSlots) and \(totalSlots)"
    }

    private var dropError: String? {
        let range = SettingsLimits.dropLimit
        return range.contains(dropLimit) ? nil : "Must be between \(range.lowerBound) and \(range.upperBound)"
    }

    private var counterbidError: String? {
        let range = SettingsLimits.counterbidHours
        guard let counterbidHours, range.contains(counterbidHours) else {
            return "Counter window must be between \(range.lowerBound) and \(range.upperBound) hours"
        }
        return nil
    }

    private var cutoffError: String? {
        let range = SettingsLimits.newBidCutoffHours
        guard let cutoffHours, range.contains(cutoffHours) else {
            return "New bid cutoff must be between \(range.lowerBound) and \(range.upperBound) hours"
        }
        return nil
    }

    private var errors: [String] {
        [totalError, draftError, dropError, counterbidError, cutoffError].compactMap { $0 }
    }

    private var hasChanges: Bool {
        totalSlots != season.totalSlots
            || draftSlots != season.draftSlots
            || dropLimit != season.dropLimit
            || counterbidHours != season.counterbidHours
            || cutoffHours != season.newBidCutoffHours
    }

    var body: some View {
        if isLocked {
            lockedBody
        } else {
            editableBody
        }
    }

    private var lockedBody: some View {
        SettingsSection("Roster & bidding") {
            SettingsValueRow("Total roster slots", value: "\(season.totalSlots)", isLocked: true)
            SettingsValueRow("Draft slots", value: "\(season.draftSlots)", isLocked: true)
            SettingsValueRow("Drop limit", value: "\(season.dropLimit)", isLocked: true)
            SettingsValueRow("Counter window", value: SettingsText.hours(season.counterbidHours), isLocked: true)
            SettingsValueRow("New-bid cutoff", value: Self.cutoffValue(season.newBidCutoffHours), isLocked: true)
        } footer: {
            SettingsLockNote(lockedRosterNote)
        }
    }

    private var editableBody: some View {
        SettingsSection(
            "Roster & bidding",
            error: model.roster.errorMessage,
            save: SettingsSaveButton(
                isEnabled: hasChanges && errors.isEmpty,
                isRunning: model.roster.isRunning,
                action: save
            )
        ) {
            SettingsStepperRow("Total roster slots", value: $totalSlots, in: SettingsLimits.totalSlots)
            SettingsStepperRow(
                "Draft slots",
                value: $draftSlots,
                in: SettingsLimits.minDraftSlots...max(SettingsLimits.minDraftSlots, totalSlots)
            )
            SettingsStepperRow("Drop limit", value: $dropLimit, in: SettingsLimits.dropLimit)
            SettingsNumberFieldRow("Counter window", text: $counterbidText, unit: "hours", placeholder: "24")
            SettingsNumberFieldRow("New-bid cutoff", text: $cutoffText, unit: "hours", placeholder: "48")
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(errors, id: \.self) { SettingsFieldError($0) }
                FRFootnote(openSlotsText)
                FRFootnote(
                    "Drop limit is per team per season (0–10). The counter window is the time to counter "
                        + "when outbid (1–72h)."
                )
                FRFootnote(cutoffHelp)
            }
        }
        .disabled(model.roster.isRunning)
        .onChange(of: totalSlots) { _, total in
            // Say so: the change happens in a row the user isn't looking at.
            if draftSlots > total, total >= SettingsLimits.minDraftSlots {
                draftSlots = total
                Announcer.announce("Draft slots reduced to \(total) to fit the roster.")
            }
        }
        .onChange(of: season.totalSlots) { _, new in totalSlots = new }
        .onChange(of: season.draftSlots) { _, new in draftSlots = new }
        .onChange(of: season.dropLimit) { _, new in dropLimit = new }
        .onChange(of: season.counterbidHours) { _, new in counterbidText = String(new) }
        .onChange(of: season.newBidCutoffHours) { _, new in cutoffText = String(new) }
    }

    private var lockedRosterNote: String {
        let cutoff = season.newBidCutoffHours == 0 ? "no new-bid cutoff" : "\(season.newBidCutoffHours)h new-bid cutoff"
        let pickupSlots = season.totalSlots - season.draftSlots
        let current = "\(season.draftSlots) draft slots, \(pickupSlots) pickup slots, \(season.dropLimit) max drops, "
            + "\(season.counterbidHours)h counterbid window, \(cutoff)"
        return "Bidding configuration cannot be changed after the draft has started. Current settings: \(current)."
    }

    private var openSlotsText: String {
        let pickup = totalSlots - draftSlots
        if pickup > 0 {
            return "Open after the draft: \(SettingsText.plural(pickup, "slot", "slots")). Teams draft \(draftSlots) "
                + "and fill the remaining \(pickup) of \(totalSlots) roster slots by bidding — or by dropping a "
                + "movie and bidding on a replacement."
        }
        return "The draft fills all \(totalSlots) roster slots. Teams can still bid by dropping a movie first."
    }

    private var cutoffHelp: String {
        guard let cutoffHours, SettingsLimits.newBidCutoffHours.contains(cutoffHours) else {
            return "New bids close this many hours before weekly processing (0–144h)."
        }
        if cutoffHours == 0 {
            return "New bids stay open all week (0 turns the cutoff off)."
        }
        return "After this point teams can only raise or counter bids already placed. "
            + "\(cutoffHours) puts the cutoff at \(Self.cutoffDayLabel(cutoffHours))."
    }

    private static func cutoffValue(_ hours: Int) -> String {
        hours == 0 ? "Off" : "\(hours) h before processing"
    }

    /// The weekday and time an offset lands on, counting back from the weekly
    /// processing deadline (Saturday 8 PM UTC), e.g. "Thursday 8:00 PM UTC".
    static func cutoffDayLabel(_ hours: Int) -> String {
        // Any Saturday 20:00 UTC works: only the weekday and time are read off.
        let referenceDeadline = Date(timeIntervalSince1970: 1_786_824_000) // 2026-08-15 20:00 UTC
        let date = referenceDeadline.addingTimeInterval(-Double(hours) * 3600)
        let style = Date.FormatStyle(timeZone: .gmt).weekday(.wide).hour().minute()
        return date.formatted(style) + " UTC"
    }

    private func save() {
        guard hasChanges, errors.isEmpty, let counterbidHours, let cutoffHours else { return }
        let update = LeagueUpdate.roster(
            totalSlots: totalSlots,
            draftSlots: draftSlots,
            dropLimit: dropLimit,
            counterbidHours: counterbidHours,
            newBidCutoffHours: cutoffHours
        )
        model.save(update, with: model.roster) {
            Announcer.announce("Bidding configuration updated.")
        }
    }
}

// MARK: - Counterpicks

struct SettingsCounterpickSection: View {
    let season: League
    let model: SettingsModel

    @State private var draftSlots: Int
    @State private var biddingSlots: Int
    @State private var blockDrops: Bool

    init(season: League, model: SettingsModel) {
        self.season = season
        self.model = model
        _draftSlots = State(initialValue: season.draftCounterpickSlots)
        _biddingSlots = State(initialValue: season.biddingCounterpickSlots)
        _blockDrops = State(initialValue: season.counterpicksBlockDrops)
    }

    private var isLocked: Bool { season.status != .setup }

    private var rangeError: String? {
        let range = SettingsLimits.counterpickSlots
        guard range.contains(draftSlots), range.contains(biddingSlots) else {
            return "Counterpick slots must be between \(range.lowerBound) and \(range.upperBound)"
        }
        return nil
    }

    private var totalNote: String {
        let detail = draftSlots > 0 || biddingSlots > 0
            ? "Teams can bet against opponent movies to earn points if they underperform."
            : "Counterpicks are disabled. Enable by setting slots above 0."
        return "Total counterpicks available: \(draftSlots + biddingSlots) per team. \(detail)"
    }

    private var lockedNote: String {
        let blocking = season.counterpicksBlockDrops ? "enabled" : "disabled"
        let current = "\(season.draftCounterpickSlots) draft slots, \(season.biddingCounterpickSlots) bidding slots, "
            + "drop blocking \(blocking)"
        return "Counterpick configuration cannot be changed after the draft has started. Current settings: \(current)."
    }

    private var hasChanges: Bool {
        draftSlots != season.draftCounterpickSlots
            || biddingSlots != season.biddingCounterpickSlots
            || blockDrops != season.counterpicksBlockDrops
    }

    var body: some View {
        if isLocked {
            SettingsSection("Counterpicks") {
                SettingsValueRow("Draft counterpick slots", value: "\(season.draftCounterpickSlots)", isLocked: true)
                SettingsValueRow("Bidding counterpick slots", value: "\(season.biddingCounterpickSlots)", isLocked: true)
                SettingsValueRow(
                    "Block drops on counterpicked movies",
                    value: season.counterpicksBlockDrops ? "On" : "Off",
                    isLocked: true
                )
            } footer: {
                SettingsLockNote(lockedNote)
            }
        } else {
            SettingsSection(
                "Counterpicks",
                error: model.counterpicks.errorMessage,
                save: SettingsSaveButton(
                    isEnabled: hasChanges && rangeError == nil,
                    isRunning: model.counterpicks.isRunning,
                    action: save
                )
            ) {
                SettingsStepperRow("Draft counterpick slots", value: $draftSlots, in: SettingsLimits.counterpickSlots)
                SettingsStepperRow("Bidding counterpick slots", value: $biddingSlots, in: SettingsLimits.counterpickSlots)
                SettingsToggleRow(
                    "Block drops on counterpicked movies",
                    detail: "Prevent dropping movies that have been counterpicked by opponents",
                    isOn: $blockDrops
                )
            } footer: {
                VStack(alignment: .leading, spacing: 6) {
                    if let rangeError { SettingsFieldError(rangeError) }
                    FRFootnote(totalNote)
                }
            }
            .disabled(model.counterpicks.isRunning)
            .onChange(of: season.draftCounterpickSlots) { _, new in draftSlots = new }
            .onChange(of: season.biddingCounterpickSlots) { _, new in biddingSlots = new }
            .onChange(of: season.counterpicksBlockDrops) { _, new in blockDrops = new }
        }
    }

    private func save() {
        guard hasChanges, rangeError == nil else { return }
        let update = LeagueUpdate.counterpicks(draftSlots: draftSlots, biddingSlots: biddingSlots, blockDrops: blockDrops)
        model.save(update, with: model.counterpicks) {
            Announcer.announce("Counterpick configuration updated.")
        }
    }
}

// MARK: - Trading

struct SettingsTradingSection: View {
    let season: League
    let model: SettingsModel

    @State private var tradesEnabled: Bool
    @State private var hasDeadline: Bool
    @State private var deadline: DateOnly
    @State private var reviewEnabled: Bool
    @State private var vetoText: String
    @State private var defaultText: String
    @State private var minText: String
    @State private var maxText: String

    init(season: League, model: SettingsModel) {
        self.season = season
        self.model = model
        _tradesEnabled = State(initialValue: season.tradesEnabled)
        _hasDeadline = State(initialValue: season.tradeDeadline != nil)
        _deadline = State(initialValue: season.tradeDeadline ?? season.seasonEnd)
        _reviewEnabled = State(initialValue: season.tradeReviewEnabled)
        _vetoText = State(initialValue: String(season.tradeVetoHours))
        _defaultText = State(initialValue: Self.text(season.tradeOfferExpiryDefaultHours))
        _minText = State(initialValue: Self.text(season.tradeOfferExpiryMinHours))
        _maxText = State(initialValue: Self.text(season.tradeOfferExpiryMaxDays))
    }

    private static func text(_ value: Int?) -> String {
        value.map(String.init) ?? ""
    }

    private var isCompleted: Bool { season.status == .completed }

    /// Empty is valid (nil: the app default); otherwise a whole number in range.
    private enum Nullable {
        case value(Int?)
        case invalid
    }

    private static func parse(_ text: String, in range: ClosedRange<Int>) -> Nullable {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return .value(nil) }
        guard let number = Int(trimmed), range.contains(number) else { return .invalid }
        return .value(number)
    }

    private var errors: [String] {
        var list: [String] = []
        if reviewEnabled {
            let range = SettingsLimits.vetoHours
            let hours = SettingsText.integer(vetoText)
            if hours.map({ !range.contains($0) }) ?? true {
                list.append("Review window must be between \(range.lowerBound) and \(range.upperBound) hours")
            }
        }
        if hasDeadline, deadline > season.seasonEnd {
            list.append("The trade deadline cannot fall after the season ends (\(season.seasonEnd.formattedFull))")
        }
        let defaultValue = Self.parse(defaultText, in: SettingsLimits.expiryDefaultHours)
        let minValue = Self.parse(minText, in: SettingsLimits.expiryMinHours)
        let maxValue = Self.parse(maxText, in: SettingsLimits.expiryMaxDays)
        if case .invalid = defaultValue {
            list.append("Default offer window must be a whole number between 1 and 2160 hours")
        }
        if case .invalid = minValue {
            list.append("Minimum offer window must be a whole number between 1 and 168 hours")
        }
        if case .invalid = maxValue {
            list.append("Maximum offer window must be a whole number between 1 and 90 days")
        }
        if case .value(let d) = defaultValue, case .value(let mn) = minValue, case .value(let mx) = maxValue {
            let effectiveDefault = d ?? SettingsLimits.appDefaultExpiryHours
            let effectiveMin = mn ?? SettingsLimits.appMinExpiryHours
            let effectiveMax = mx ?? SettingsLimits.appMaxExpiryDays
            if effectiveMin > effectiveDefault || effectiveDefault > effectiveMax * 24 {
                list.append(
                    "The default offer window (\(effectiveDefault) hours) must be between the minimum "
                        + "(\(effectiveMin) hours) and the maximum (\(effectiveMax) days)."
                )
            }
        }
        return list
    }

    /// The settings to send, or nil while any field is invalid.
    private var draft: TradeSettings? {
        guard errors.isEmpty,
              case .value(let defaultHours) = Self.parse(defaultText, in: SettingsLimits.expiryDefaultHours),
              case .value(let minHours) = Self.parse(minText, in: SettingsLimits.expiryMinHours),
              case .value(let maxDays) = Self.parse(maxText, in: SettingsLimits.expiryMaxDays)
        else { return nil }
        // With review off the window field is hidden; keep the stored value.
        let veto = reviewEnabled ? (SettingsText.integer(vetoText) ?? season.tradeVetoHours) : season.tradeVetoHours
        return TradeSettings(
            tradesEnabled: tradesEnabled,
            tradeDeadline: hasDeadline ? deadline : nil,
            reviewEnabled: reviewEnabled,
            reviewHours: veto,
            expiryDefaultHours: defaultHours,
            expiryMinHours: minHours,
            expiryMaxDays: maxDays
        )
    }

    private var canSave: Bool {
        guard !isCompleted, let draft else { return false }
        return draft != TradeSettings(league: season)
    }

    var body: some View {
        if isCompleted {
            completedBody
        } else {
            editableBody
        }
    }

    private var completedBody: some View {
        SettingsSection("Trading") {
            SettingsValueRow("Allow trading", value: season.tradesEnabled ? "On" : "Off", isLocked: true)
            SettingsValueRow(
                "Trade deadline",
                value: season.tradeDeadline?.formattedFull ?? "None",
                isLocked: true
            )
            SettingsValueRow("Commissioner review", value: season.tradeReviewEnabled ? "On" : "Off", isLocked: true)
            if season.tradeReviewEnabled {
                SettingsValueRow("Review window", value: SettingsText.hours(season.tradeVetoHours), isLocked: true)
            }
        } footer: {
            SettingsLockNote("This season is complete, so its trade settings are final.")
        }
    }

    private var editableBody: some View {
        SettingsSection(
            "Trading",
            error: model.trades.errorMessage,
            save: SettingsSaveButton(isEnabled: canSave, isRunning: model.trades.isRunning, action: save)
        ) {
            SettingsToggleRow(
                "Allow trading",
                detail: tradesEnabled
                    ? "Teams can propose trades to each other while the league is active."
                    : "Trading is off — new offers are refused, and offers already open cannot be accepted.",
                isOn: $tradesEnabled
            )
            SettingsToggleRow(
                "Trade deadline",
                detail: hasDeadline
                    ? "The last day trades can happen, inclusive. An offer running past it is cut short to it."
                    : "No deadline — trades stay open until the season ends on \(season.seasonEnd.formattedFull).",
                isOn: $hasDeadline
            )
            if hasDeadline {
                SettingsDateRow("Last trade day", date: $deadline, through: season.seasonEnd)
            }
            SettingsToggleRow(
                "Commissioner review",
                detail: reviewEnabled
                    ? "An accepted trade waits before it executes, so you can veto or approve it early."
                    : "An accepted trade executes on the next processing run with no review.",
                isOn: $reviewEnabled
            )
            if reviewEnabled {
                SettingsNumberFieldRow("Review window", text: $vetoText, unit: "hours", placeholder: "24")
            }
            SettingsNumberFieldRow(
                "Default offer window",
                text: $defaultText,
                unit: "hours",
                placeholder: String(SettingsLimits.appDefaultExpiryHours)
            )
            SettingsNumberFieldRow(
                "Minimum offer window",
                text: $minText,
                unit: "hours",
                placeholder: String(SettingsLimits.appMinExpiryHours)
            )
            SettingsNumberFieldRow(
                "Maximum offer window",
                text: $maxText,
                unit: "days",
                placeholder: String(SettingsLimits.appMaxExpiryDays)
            )
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(errors, id: \.self) { SettingsFieldError($0) }
                if reviewEnabled {
                    FRFootnote(vetoHelp)
                }
                FRFootnote(
                    "Offer windows: how long an offer can stand before it expires unanswered. Leave a field "
                        + "blank to use the app default (default 1–2160h, minimum 1–168h, maximum 1–90 days)."
                )
                FRFootnote("Trade settings stay editable until the season is complete.")
            }
        }
        .disabled(model.trades.isRunning)
        .onChange(of: TradeSettings(league: season)) { _, new in reset(to: new) }
    }

    private var vetoHelp: String {
        if SettingsText.integer(vetoText) == 0 {
            return "No waiting — an accepted trade executes on the next run (0 turns the window off)."
        }
        return "How long you have to veto after both teams agree (0–168h)."
    }

    private func reset(to settings: TradeSettings) {
        tradesEnabled = settings.tradesEnabled
        hasDeadline = settings.tradeDeadline != nil
        deadline = settings.tradeDeadline ?? season.seasonEnd
        reviewEnabled = settings.reviewEnabled
        vetoText = String(settings.reviewHours)
        defaultText = Self.text(settings.expiryDefaultHours)
        minText = Self.text(settings.expiryMinHours)
        maxText = Self.text(settings.expiryMaxDays)
    }

    private func save() {
        guard canSave, let draft else { return }
        model.save(.trades(draft), with: model.trades) {
            Announcer.announce("Trade settings updated.")
        }
    }
}
