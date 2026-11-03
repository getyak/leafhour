import ActivityKit
import SwiftUI
import WidgetKit

@main struct LeafhourListeningWidgets: WidgetBundle {
    var body: some Widget { ListeningLiveActivity() }
}

struct ListeningLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ListeningActivityAttributes.self) { context in
            ListeningActivityView(context: context)
                .activityBackgroundTint(Color(uiColor: .secondarySystemBackground))
                .activitySystemActionForegroundColor(.primary)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { stateSymbol(context.state).padding(.top, 8) }
                DynamicIslandExpandedRegion(.trailing) { Text(context.state.phase.label).font(.caption.weight(.medium)).padding(.top, 8) }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 10) {
                        identity(context.state)
                        ListeningActivityActions(sessionID: context.attributes.sessionID, state: context.state)
                    }.padding(.top, 6)
                }
            } compactLeading: { stateSymbol(context.state) }
              compactTrailing: {
                if context.state.phase == .playing {
                    Text(context.state.speed, format: .number.precision(.fractionLength(0...2))) + Text("×")
                } else { Image(systemName: context.state.phase == .paused ? "pause.fill" : "ellipsis") }
            } minimal: { stateSymbol(context.state) }
                .keylineTint(.green.opacity(0.5))
        }
    }
}

private func identity(_ state: ListeningActivityAttributes.ContentState) -> some View {
    VStack(alignment: .leading, spacing: 3) {
        Text(state.title).font(.headline).lineLimit(1)
        if let chapter = state.chapter, !chapter.isEmpty, chapter != state.title { Text(chapter).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
    }.accessibilityElement(children: .combine)
}

private func stateSymbol(_ state: ListeningActivityAttributes.ContentState) -> some View {
    Image(systemName: state.phase.symbol)
        .foregroundStyle(.green)
        .accessibilityLabel(state.phase.label)
        .contentTransition(.symbolEffect(.replace))
}

private struct ListeningActivityView: View {
    let context: ActivityViewContext<ListeningActivityAttributes>
    @Environment(\.isLuminanceReduced) private var dimmed
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                stateSymbol(context.state).font(.title3)
                identity(context.state)
                Spacer(minLength: 4)
                Text(context.state.phase.label).font(.caption.weight(.medium)).foregroundStyle(.secondary)
            }
            ListeningActivityActions(sessionID: context.attributes.sessionID, state: context.state)
        }.padding(16)
            .animation(dimmed || reduceMotion ? nil : .easeInOut(duration: 0.25), value: context.state.phase)
    }
}

private struct ListeningActivityActions: View {
    let sessionID: String
    let state: ListeningActivityAttributes.ContentState
    private var paused: Bool { state.phase == .paused }
    var body: some View {
        HStack(spacing: 12) {
            Button(intent: ToggleListeningPlaybackIntent(sessionID: sessionID)) {
                Label(paused ? "继续" : "暂停", systemImage: paused ? "play.fill" : "pause.fill")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }.buttonStyle(.borderedProminent).tint(Color(red: 0.25, green: 0.35, blue: 0.30))
            Button(intent: StopListeningPlaybackIntent(sessionID: sessionID)) {
                Label("结束听书", systemImage: "xmark").frame(minHeight: 44)
            }.buttonStyle(.bordered).tint(.primary)
        }.font(.subheadline.weight(.medium))
    }
}
