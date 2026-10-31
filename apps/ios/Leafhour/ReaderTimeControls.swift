import SwiftUI
import LeafhourCore

struct ReaderTimeTracking: ViewModifier {
    let session: ReaderSession
    let visible: Bool
    func body(content: Content) -> some View {
        content
            .task {
                while !Task.isCancelled {
                    session.tickReadingTime()
                    do { try await Task.sleep(for: .seconds(1)) } catch { return }
                }
            }
            .onAppear { session.setReadingVisible(visible) }
            .onChange(of: visible) { _, value in
                session.setReadingVisible(value)
                if !value { Task { _ = await session.flushReadingTime() } }
            }
            .onDisappear {
                session.setReadingVisible(false); session.finishReadingTime()
                Task { _ = await session.flushReadingTime() }
            }
    }
}

struct ReaderTimeControls: View {
    @Bindable var session: ReaderSession
    @State private var source: ReadingTimeSource = .focus
    @Environment(\.readerContinueReading) private var continueReading
    private var duration: String {
        let seconds = session.readingTimeDurationSeconds
        return String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }
    var body: some View {
        Section("阅读时间") {
            if session.readingTimePhase == .idle || session.readingTimePhase == .finished {
                if session.readingTimePhase == .finished { LabeledContent("本次记录", value: duration).monospacedDigit() }
                Picker("记录方式", selection: $source) {
                    Text("专注计时").tag(ReadingTimeSource.focus)
                    Text("前台估计").tag(ReadingTimeSource.estimate)
                }
                Button("开始记录阅读时间", systemImage: "timer") { session.startReadingTime(source: source); continueReading?() }
                    .accessibilityIdentifier("reader-time-start")
            } else {
                LabeledContent(session.readingTimePhase == .active ? "正在记录" : session.readingTimeWantsRunning ? "回到正文后继续" : "已暂停", value: duration).monospacedDigit()
                if session.readingTimeWantsRunning {
                    Button("暂停计时", systemImage: "pause", action: toggleRecording)
                } else {
                    Button("继续计时", systemImage: "play", action: toggleRecording)
                }
                Button("结束本次计时", systemImage: "stop") { session.finishReadingTime(); Task { _ = await session.flushReadingTime() } }
            }
            if let error = session.readingTimeError {
                Text(error).font(.footnote).foregroundStyle(.secondary)
                Button("重试保存计时") { Task { _ = await session.flushReadingTime() } }
            }
            Text("手动开始后才记录。离开正文或切到后台会暂停；前台估计在两分钟没有操作后暂停。各设备独立计时，重叠时段在书房中合并。").font(.footnote).foregroundStyle(.secondary)
        }
    }
    func toggleRecording() {
        if session.readingTimeWantsRunning { session.pauseReadingTime() }
        else { session.resumeReadingTime(); continueReading?() }
    }
}
