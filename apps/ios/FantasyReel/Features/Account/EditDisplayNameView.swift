import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// Display name (F-03): one field, saved from the toolbar. Trimmed, 1–100
/// characters, as on the web. The menu avatar and Account update at once.
struct EditDisplayNameView: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(SessionStore.self) private var session
    @Environment(ProfileStore.self) private var profiles
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var save = AsyncAction()
    @State private var localError: String?
    @FocusState private var isFocused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                ScreenHeader("Display Name")
                    .padding(.bottom, 4)
                VStack(alignment: .leading, spacing: 8) {
                    FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                        FormFieldRow(label: "Name", labelWidth: 64) {
                            TextField("Required", text: $name)
                                .textContentType(.name)
                                .textInputAutocapitalization(.words)
                                .submitLabel(.done)
                                .focused($isFocused)
                                .onSubmit(submit)
                        }
                    }
                    .disabled(save.isRunning)
                    GroupFootnote("Shown to everyone in your leagues, on standings, rosters and Discord posts.")
                }
                if let message = localError ?? save.errorMessage {
                    InlineBanner(tone: .error, title: message)
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
        .navigationTitle("Display Name")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(verbatim: "").accessibilityHidden(true)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(save.isRunning ? "Saving…" : "Save", action: submit)
                    .fontWeight(.semibold)
                    .disabled(!hasChanges || save.isRunning)
            }
        }
        .announcesError(localError ?? save.errorMessage)
        .reportsUnsavedInput(hasChanges && !save.isRunning)
        // Fills in when the profile arrives, unless the person has typed.
        .onChange(of: profiles.profile?.displayName, initial: true) { old, new in
            if name.isEmpty || name == (old ?? "") { name = new ?? "" }
        }
        .onAppear {
            #if DEBUG
            // Screenshots skip the keyboard, whose first-run tip covers the screen.
            if ScreenshotScene.requested != nil { return }
            #endif
            isFocused = true
        }
    }

    private var hasChanges: Bool {
        DisplayName.trimmed(name) != (profiles.profile?.displayName ?? "")
    }

    private func submit() {
        guard hasChanges, !save.isRunning, let userID = session.account?.id else { return }
        localError = DisplayName.problem(name)
        guard localError == nil else { return }
        let value = DisplayName.trimmed(name)
        save.run {
            try await environment.account.updateDisplayName(value, for: userID)
            profiles.apply(displayName: value)
            await session.syncDisplayName(value)
            Announcer.announce("Display name saved.")
            dismiss()
        }
    }
}
