import SwiftUI
import LeafhourCore

struct ReaderSpeechSpeedControl: View {
    @Bindable var session: ReaderSession
    @Bindable var speech: ReaderSpeech
    var body: some View {
        VStack(spacing: 10) {
            HStack {
                Text("播放倍速")
                Spacer()
                Text(speech.speed.formatted(.number.precision(.fractionLength(0...2))) + "×")
                    .monospacedDigit().foregroundStyle(Color.leafInk)
                    .accessibilityIdentifier("reader-speech-speed-value")
            }
            Slider(value: Binding(get: { speech.speed }, set: { speech.speed = $0 }), in: 0.5...5, step: 0.05) { editing in
                if !editing { saveSpeed() }
            }
            .accessibilityLabel("播放倍速")
            .accessibilityValue(speech.speed.formatted() + "倍")
            .accessibilityIdentifier("reader-speech-speed")
            HStack {
                Text("0.5×")
                Spacer()
                Button("恢复 1×") { speech.speed = 1; saveSpeed() }.frame(minHeight: 44)
                Spacer()
                Text("5×")
            }.font(.caption).foregroundStyle(.secondary)
        }.padding(.vertical, 4)
        .onDisappear { saveSpeed() }
    }
    private func saveSpeed() {
        guard session.state.preferences.speechSpeed != speech.speed else { return }
        var preferences = session.state.preferences
        preferences.speechSpeed = speech.speed
        session.changePreferences(preferences)
    }
}
