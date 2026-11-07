import SwiftUI
import UIKit

/// UIKit arbitrates hold vs tap: a successful hold cancels the button's tap,
/// so releasing a voice message cannot also open the conversation.
struct ReaderQuickAIButton: View {
    @Bindable var capture: ReaderQuickCapture
    @Bindable var tools: ReaderCloudTools
    let paper: Color
    let onOpen: () -> Void
    let onStart: () -> Void
    let onRelease: (Bool) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathing = false
    private var waiting: Bool { tools.quickQuestionStatus == .pending }
    var body: some View {
        HStack(spacing: 8) {
            if capture.isCapturing || capture.phase == .finishing {
                Text(capture.phase == .preparing ? "正在开启麦克风" : capture.phase == .finishing ? "正在保留录音" : "松开发送 · 上滑取消")
                    .font(.caption).padding(.horizontal, 12).padding(.vertical, 8)
                    .background(paper, in: Capsule()).allowsHitTesting(false)
            }
            if !capture.isCapturing, let error = capture.error {
                Text(error + (capture.transcript.isEmpty ? "" : "\n转写草稿（未发送）：" + capture.transcript))
                    .font(.caption).lineLimit(3).frame(maxWidth: 220, alignment: .leading).textSelection(.enabled)
                    .padding(10).background(paper, in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityIdentifier("quick-recording-error")
            }
            NativeQuickAIControl(capturing: capture.isCapturing, status: capture.error == nil && (tools.error == nil || tools.quickQuestionStatus != .idle) ? tools.quickQuestionStatus : .attention,
                                 canRecord: tools.canStartQuickQuestion && capture.canBegin, onOpen: onOpen, onStart: onStart, onRelease: onRelease)
                .frame(width: 48, height: 48)
                .modifier(ReaderGlassSurface(paper: paper, cornerRadius: 24))
                .opacity(waiting && breathing && !reduceMotion ? 0.58 : 1)
        }
        .onChange(of: waiting, initial: true) { _, value in breathing = value }
        .animation(waiting && !reduceMotion ? .easeInOut(duration: 1.8).repeatForever(autoreverses: true) : nil, value: breathing)
    }
}

private struct NativeQuickAIControl: UIViewRepresentable {
    let capturing: Bool
    let status: ReaderQuickQuestionStatus
    let canRecord: Bool
    let onOpen: () -> Void
    let onStart: () -> Void
    let onRelease: (Bool) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> UIButton {
        let button = UIButton(type: .system)
        button.addTarget(context.coordinator, action: #selector(Coordinator.tap), for: .touchUpInside)
        let hold = UILongPressGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.hold(_:)))
        hold.minimumPressDuration = 0.35; hold.allowableMovement = 1000; hold.cancelsTouchesInView = true
        button.addGestureRecognizer(hold)
        button.accessibilityIdentifier = "reader-ai"
        return button
    }
    func updateUIView(_ button: UIButton, context: Context) {
        context.coordinator.parent = self
        var configuration = UIButton.Configuration.plain()
        configuration.image = UIImage(systemName: capturing ? "mic.fill" : "leaf")
        configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 21, weight: .medium)
        configuration.baseForegroundColor = UIColor(Color.leafInk)
        if status == .ready || status == .attention {
            configuration.image = UIImage(systemName: status == .ready ? "leaf.fill" : "exclamationmark.bubble")
        }
        button.configuration = configuration
        button.accessibilityLabel = capturing ? "结束录音并发送" : "与 AI 聊这本书"
        button.accessibilityValue = capturing ? "正在录音" : status == .ready ? "有新回复" : status == .pending ? "问题已送出" : status == .attention ? "有消息需要恢复" : ""
        button.accessibilityHint = "点按打开全屏 AI，长按说话，松开发送，上滑取消"
        button.accessibilityCustomActions = [UIAccessibilityCustomAction(name: capturing ? "取消录音" : "开始语音输入", target: context.coordinator, selector: #selector(Coordinator.accessibleRecord))]
    }
    static func dismantleUIView(_ button: UIButton, coordinator: Coordinator) {
        if coordinator.holding { coordinator.parent.onRelease(true); coordinator.holding = false }
    }
    @MainActor final class Coordinator: NSObject {
        var parent: NativeQuickAIControl
        var holding = false
        private var origin = CGPoint.zero
        init(_ parent: NativeQuickAIControl) { self.parent = parent }
        @objc func tap() {
            if parent.capturing { parent.onRelease(false) } else { parent.onOpen() }
        }
        @objc func accessibleRecord() -> Bool {
            if parent.capturing { parent.onRelease(true) }
            else if parent.canRecord { parent.onStart() }
            return true
        }
        @objc func hold(_ gesture: UILongPressGestureRecognizer) {
            switch gesture.state {
            case .began:
                guard parent.canRecord, !parent.capturing else { return }
                holding = true; origin = gesture.location(in: gesture.view)
                UIImpactFeedbackGenerator(style: .light).impactOccurred(); parent.onStart()
            case .ended:
                guard holding else { return }; holding = false
                parent.onRelease(gesture.location(in: gesture.view).y < origin.y - 60)
            case .cancelled, .failed:
                if holding { holding = false; parent.onRelease(true) }
            default: break
            }
        }
    }
}
