import SwiftUI
import AVFoundation
import Observation
import LeafhourCore

extension Notification.Name {
    static let leafhourChatMicrophoneWillStart = Notification.Name("leafhour.chat.microphone.will-start")
}

@MainActor @Observable
private final class ChatVoicePlayback: NSObject, AVAudioPlayerDelegate {
    var playing = false
    var loading = false
    var error: String?
    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var generation = UUID()
    var elapsed: TimeInterval { player?.currentTime ?? 0 }
    func toggle(resolve: () async throws -> URL) async {
        if playing { player?.pause(); playing = false; return }
        guard !loading else { return }
        let marker = generation; loading = true; error = nil
        defer { if marker == generation { loading = false } }
        do {
            if player == nil {
                let url = try await resolve()
                guard marker == generation, !Task.isCancelled else { return }
                player = try AVAudioPlayer(contentsOf: url); player?.delegate = self; player?.prepareToPlay()
            }
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            try AVAudioSession.sharedInstance().setActive(true)
            playing = player?.play() == true
        } catch { if marker == generation { self.error = "语音暂时无法播放，可稍后重试。" } }
    }
    func stop() { generation = UUID(); player?.stop(); player = nil; playing = false; loading = false }
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) { Task { @MainActor [weak self] in self?.playing = false } }
}

struct ChatVoiceMessageView: View {
    let voice: ChatVoiceReceipt
    let resolve: () async throws -> URL
    var playbackAllowed = true
    @State private var playback = ChatVoicePlayback()
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Button { Task { await playback.toggle(resolve: resolve) } } label: {
                HStack(spacing: 12) {
                    if playback.loading { ProgressView().frame(width: 28) }
                    else { Image(systemName: playback.playing ? "pause.fill" : "play.fill").font(.body).frame(width: 28) }
                    Image(systemName: "waveform").font(.title2.weight(.light)).accessibilityHidden(true)
                    Text("语音").font(.subheadline)
                    Spacer(minLength: 16)
                    TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                        let seconds = playback.playing ? Int(playback.elapsed) : voice.durationMs / 1000
                        Text(String(format: "%d:%02d", seconds / 60, seconds % 60)).font(.caption.monospacedDigit())
                    }
                }.frame(minHeight: 44).contentShape(Rectangle())
            }.buttonStyle(.plain).disabled(playback.loading || !playbackAllowed)
                .accessibilityLabel(playback.playing ? "暂停语音" : "播放语音")
                .accessibilityIdentifier("chat-voice-" + voice.id)
            if let error = playback.error { Text(error).font(.caption).foregroundStyle(.secondary) }
        }.onDisappear { playback.stop() }
            .onChange(of: playbackAllowed) { _, allowed in if !allowed { playback.stop() } }
            .onReceive(NotificationCenter.default.publisher(for: .leafhourChatMicrophoneWillStart)) { _ in playback.stop() }
    }
}
