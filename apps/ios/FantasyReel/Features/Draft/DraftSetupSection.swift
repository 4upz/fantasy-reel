import FantasyReelCore
import SwiftUI

/// The draft room before the draft (V2DraftSetup): readiness and Start Draft,
/// the draft order (owner can randomize or drag to reorder), and the owner's
/// invite tools.
struct DraftSetupSection: View {
    let model: DraftRoomModel
    let snapshot: DraftSnapshot

    @State private var confirmStart = false

    private var canStart: Bool { snapshot.teamCount >= 2 }

    var body: some View {
        let isOwner = model.ownerActions.contains(.startDraft)
        FRCard(tone: isOwner && canStart ? .gold : nil) {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(canStart ? "Ready to draft" : "Waiting for teams")
                        .frFont(.cardTitle)
                        .foregroundStyle(Color.frText)
                    Text("\(teams(snapshot.teamCount)) · \(rounds(snapshot.draftRounds)) · snake order")
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                }
                .accessibilityElement(children: .combine)
                if isOwner {
                    Button("Start Draft") { confirmStart = true }
                        .buttonStyle(.fr(.primary, isLoading: model.phaseAction.isRunning))
                        .disabled(!canStart)
                    Text(canStart ? "The order locks at the start." : "Needs 2+ teams. The order locks at the start.")
                        .frFont(.label)
                        .foregroundStyle(Color.frTextSecondary)
                    if let message = model.phaseAction.errorMessage {
                        Text(message)
                            .frFont(.label)
                            .foregroundStyle(Color.frError)
                    }
                } else {
                    Text("The commissioner starts the draft. You'll pick here when it's your turn.")
                        .frFont(.bodySmall)
                        .foregroundStyle(Color.frTextSecondary)
                }
            }
        }
        .confirmationDialog("Start the draft?", isPresented: $confirmStart, titleVisibility: .visible) {
            Button("Start Draft") { model.startDraft() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(snapshot.league.customDraftOrder
                ? "The draft order locks and the first team goes on the clock."
                : "The draft order is randomized and locks, and the first team goes on the clock.")
        }
        DraftOrderSection(model: model, snapshot: snapshot, isEditable: model.ownerActions.contains(.editOrder))
        LeagueInvitesSection()
    }

    private func teams(_ count: Int) -> String { count == 1 ? "1 team" : "\(count) teams" }
    private func rounds(_ count: Int) -> String { count == 1 ? "1 round" : "\(count) rounds" }
}

/// The order teams pick in round 1. Before a custom order is saved the server
/// randomizes it at the start, so the list then shows join order only.
private struct DraftOrderSection: View {
    let model: DraftRoomModel
    let snapshot: DraftSnapshot
    let isEditable: Bool

    @State private var dropTarget: ParticipantID?

    var body: some View {
        let order = snapshot.orderedParticipants
        VStack(spacing: 8) {
            SectionHeader("Draft order", detail: order.count == 1 ? "1 team" : "\(order.count) teams")
            HStack {
                Text("Order")
                    .frFont(.label)
                    .foregroundStyle(Color.frTextSecondary)
                FRBadge(snapshot.league.customDraftOrder ? "Custom" : "Random at start", tone: snapshot.league.customDraftOrder ? .gold : .neutral)
                Spacer()
                if isEditable {
                    Button("Randomize") { model.randomizeOrder() }
                        .buttonStyle(.fr(.secondary, size: .compact, isLoading: model.orderAction.isRunning))
                        .disabled(order.count < 2)
                }
            }
            FRRowGroup(separatorInset: 108) {
                ForEach(Array(order.enumerated()), id: \.element.id) { index, member in
                    orderRow(member, position: index + 1, count: order.count)
                }
            }
            Text(footnote)
                .frFont(.label)
                .foregroundStyle(Color.frTextSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let message = model.orderAction.errorMessage {
                Text(message)
                    .frFont(.label)
                    .foregroundStyle(Color.frError)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var footnote: String {
        isEditable
            ? "Drag to reorder. Snake order: round 2 runs in reverse."
            : "Snake order: round 2 runs in reverse."
    }

    @ViewBuilder
    private func orderRow(_ member: LeagueMember, position: Int, count: Int) -> some View {
        let isMe = member.userID == model.userID
        let row = HStack(spacing: 0) {
            Text("\(position)")
                .frFont(.number)
                .foregroundStyle(Color.frTextSecondary)
                .frame(width: 32)
                .padding(.leading, 12)
            ListRow(
                title: member.teamName,
                meta: isMe ? "\(member.displayName) · You" : member.displayName
            ) {
                Avatar(name: member.teamName, imageURL: member.team?.avatarURL, size: .custom(36), corners: .rounded)
            } trailing: {
                if isEditable {
                    Image(systemName: "line.3.horizontal")
                        .foregroundStyle(Color.frTextMuted)
                        .accessibilityHidden(true)
                }
            }
            .padding(.leading, -4)
        }
        .background(dropTarget == member.id ? Color.frGoldTint : Color.clear)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Pick \(position): \(member.teamName), \(member.displayName)\(isMe ? ", you" : "")")

        if isEditable {
            row
                .draggable(member.id.rawValue)
                .dropDestination(for: String.self) { items, _ in
                    guard let id = items.first else { return false }
                    model.move(ParticipantID(rawValue: id), to: position - 1)
                    return true
                } isTargeted: { targeted in
                    dropTarget = targeted ? member.id : (dropTarget == member.id ? nil : dropTarget)
                }
                .accessibilityActions {
                    if position > 1 {
                        Button("Move up") { model.move(member.id, to: position - 2) }
                    }
                    if position < count {
                        Button("Move down") { model.move(member.id, to: position) }
                    }
                }
        } else {
            row
        }
    }
}
