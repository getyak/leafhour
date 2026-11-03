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
                Button("0.5×") { speech.speed = 0.5; saveSpeed() }.frame(minWidth: 44, minHeight: 44).accessibilityLabel("设为0.5倍")
                Spacer()
                Button("恢复 1×") { speech.speed = 1; saveSpeed() }.frame(minHeight: 44)
                Spacer()
                Button("5×") { speech.speed = 5; saveSpeed() }.frame(minWidth: 44, minHeight: 44).accessibilityLabel("设为5倍")
            }.buttonStyle(.borderless).font(.caption).foregroundStyle(.secondary)
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

/// UIKit owns the hold lifetime, including cancellation by scrolling or leaving.
struct ReaderListeningBoostButton: UIViewRepresentable {
    @Bindable var speech: ReaderSpeech
    let onSettings: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> UIButton {
        let button = UIButton(type: .system)
        button.titleLabel?.font = UIFont.monospacedDigitSystemFont(ofSize: 17, weight: .regular)
        button.accessibilityIdentifier = "reader-listening-speed-open"
        button.accessibilityLabel = "倍速，长按临时加速"
        button.accessibilityHint = "松开恢复原速；轻点设置语速"
        button.addTarget(context.coordinator, action: #selector(Coordinator.open), for: .touchUpInside)
        let hold = UILongPressGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.hold(_:)))
        hold.minimumPressDuration = 0.35; button.addGestureRecognizer(hold)
        return button
    }
    func updateUIView(_ view: UIButton, context: Context) {
        context.coordinator.parent = self
        view.setTitle(speech.speed.formatted(.number.precision(.fractionLength(0...2))) + "×", for: .normal)
        view.accessibilityValue = speech.speed.formatted() + "倍"
        if !speech.playing { context.coordinator.cancel() }
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UIButton, context: Context) -> CGSize? {
        CGSize(width: max(54, uiView.intrinsicContentSize.width), height: 44)
    }
    static func dismantleUIView(_ uiView: UIButton, coordinator: Coordinator) { coordinator.cancel() }
    @MainActor final class Coordinator: NSObject {
        var parent: ReaderListeningBoostButton
        private var task: Task<Void, Never>?
        init(_ parent: ReaderListeningBoostButton) { self.parent = parent }
        @objc func open() { parent.onSettings() }
        @objc func hold(_ hold: UILongPressGestureRecognizer) {
            if hold.state == .began {
                guard parent.speech.playing else { return }
                parent.speech.beginSpeedBoost()
                task = Task { [weak self] in
                    while !Task.isCancelled {
                        do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
                        guard let self, self.parent.speech.playing else { return }
                        self.parent.speech.increaseSpeedBoost()
                    }
                }
            } else if hold.state == .ended || hold.state == .cancelled || hold.state == .failed { cancel() }
        }
        func cancel() { task?.cancel(); task = nil; parent.speech.endSpeedBoost() }
    }
}
