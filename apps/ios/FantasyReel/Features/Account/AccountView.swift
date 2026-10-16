import SwiftUI

/// Account: profile, appearance, email preferences, connected accounts,
/// password, legal, support, sign out, delete account (F-03, F-02, L-02, F-18).
///
/// The foundation ships Appearance and Sign Out so the app is usable end to end;
/// the Account feature builds the rest around them.
struct AccountView: View {
    @Environment(SessionStore.self) private var session
    @AppStorage(AppearancePreference.storageKey) private var appearance: AppearancePreference = .system
    @State private var signOut = AsyncAction()

    var body: some View {
        Form {
            Section {
                Picker("Appearance", selection: $appearance) {
                    ForEach(AppearancePreference.allCases) { option in
                        Text(option.title).tag(option)
                    }
                }
            }
            Section {
                Button("Sign Out", role: .destructive) {
                    signOut.run { await session.signOut() }
                }
                .disabled(signOut.isRunning)
            }
        }
        .navigationTitle("Account")
    }
}
