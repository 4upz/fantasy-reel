import SwiftUI

/// Account: profile, appearance, email preferences, connected accounts,
/// password, legal, support, sign out, delete account (F-03, F-02, L-02, F-18).
///
/// The foundation ships Appearance and Sign Out so the app is usable end to end;
/// the Account feature builds the rest around them.
struct AccountView: View {
    @Environment(SessionStore.self) private var session
    @Environment(AdminStore.self) private var admin
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
            if admin.isAdmin == true {
                Section {
                    GrowthDashboardRow()
                        .listRowInsets(EdgeInsets())
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
        // Asked here rather than on the row: the row is absent for everyone
        // who isn't an administrator, so a task on it would never run.
        .task { await admin.checkIfNeeded() }
    }
}
