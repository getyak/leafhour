import XCTest
import LeafhourCore
import UIKit
@testable import Leafhour

@MainActor final class ReaderQuickQuestionTests: XCTestCase {
    func testSleepingChromeMovingTheButtonDoesNotLookLikeAnUpwardCancel() {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 800))
        let button = UIButton(frame: CGRect(x: 300, y: 400, width: 48, height: 48))
        window.addSubview(button)
        let gesture = WindowPositionHold(target: nil, action: nil)
        gesture.coordinateWindow = window; button.addGestureRecognizer(gesture)
        var cancellations: [Bool] = []
        let input = NativeQuickAIControl(capturing: false, status: .idle, canRecord: true, onOpen: {},
            onStart: { button.frame.origin.y += 150 }, onRelease: { cancellations.append($0) })
        let coordinator = NativeQuickAIControl.Coordinator(input)
        for slideUp in [false, true] {
            button.frame.origin.y = 400; gesture.windowPoint = CGPoint(x: 324, y: 424)
            gesture.inputState = .began; coordinator.hold(gesture)
            if slideUp { gesture.windowPoint.y -= 80 }
            gesture.inputState = .ended; coordinator.hold(gesture)
        }
        XCTAssertEqual(cancellations, [false, true], "Chrome movement is not finger movement; an actual upward slide still cancels")
    }

    func testReleaseOrCancelInTheStartTurnNeverStartsTheMicrophone() async {
        for cancel in [false, true] {
            let recorder = SuspendedQuickRecorder(), capture = ReaderQuickCapture(recorder: recorder)
            capture.start { _, _ in XCTFail("An already released hold cannot send") }
            if cancel { capture.cancel() } else { capture.finish() }
            for _ in 0..<10 { await Task.yield() }
            XCTAssertEqual(recorder.starts, 0, "A queued start must validate ownership before touching permissions or the microphone")
            recorder.completePreparation()
            for _ in 0..<10 { await Task.yield() }
            capture.cancel()
        }
    }

    func testReleaseDuringPermissionPreparationCancelsLateCaptureWithoutSending() async {
        let recorder = SuspendedQuickRecorder()
        let subject = ReaderQuickCapture(recorder: recorder)
        var sends = 0
        subject.start { _, _ in sends += 1 }
        await Task.yield()
        subject.finish()
        recorder.completePreparation()
        for _ in 0..<10 { await Task.yield() }
        XCTAssertFalse(subject.isCapturing)
        XCTAssertFalse(recorder.recording)
        XCTAssertEqual(sends, 0)
        XCTAssertFalse(subject.isCapturing)
    }

    func testUpwardCancellationDoesNotSendOrOpenAConversation() async {
        let recorder = SuspendedQuickRecorder()
        let capture = ReaderQuickCapture(recorder: recorder)
        var sends = 0
        capture.start { _, _ in sends += 1 }
        await Task.yield(); recorder.completePreparation()
        for _ in 0..<10 { await Task.yield() }
        XCTAssertTrue(capture.isCapturing)
        capture.cancel()
        capture.finish()
        XCTAssertEqual(sends, 0)
        XCTAssertFalse(recorder.recording)
        XCTAssertFalse(capture.isCapturing)
    }

    func testFinishOnceRetainsAudioAndFrozenCallbackEvenIfReaderMoves() async {
        let recorder = SuspendedQuickRecorder(), capture = ReaderQuickCapture(recorder: recorder)
        var currentPage = "page-three", delivered: [String] = [], submitValues: [Bool] = []
        let capturedPage = currentPage
        capture.start { voice, submit in
            XCTAssertEqual(voice.transcript, "Explain this sentence")
            delivered.append(capturedPage); submitValues.append(submit)
        }
        await Task.yield(); recorder.completePreparation()
        for _ in 0..<10 { await Task.yield() }
        currentPage = "page-five"
        capture.finish(); capture.finish()
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(delivered, ["page-three"])
        XCTAssertEqual(submitValues, [true])
        XCTAssertEqual(recorder.finishes, 1)
        XCTAssertEqual(currentPage, "page-five")
    }

    func testRecorderFailureDuringAHoldDoesNotLeaveCapturePermanentlyLocked() async {
        let recorder = SuspendedQuickRecorder(), capture = ReaderQuickCapture(recorder: recorder)
        capture.start { _, _ in XCTFail("A failed recording cannot be sent") }
        await Task.yield(); recorder.completePreparation()
        for _ in 0..<10 { await Task.yield() }
        recorder.recording = false; recorder.error = "The microphone stopped saving"
        capture.finish()
        XCTAssertTrue(capture.canBegin, "A failed system capture must release the hold state")
        XCTAssertFalse(capture.isCapturing)
        XCTAssertEqual(capture.error, "The microphone stopped saving")
    }

    func testRepeatedHoldWhileFinalizingDoesNotReplaceThePlaybackHandoff() async {
        let recorder = SuspendedQuickRecorder(), capture = ReaderQuickCapture(recorder: recorder)
        var handoffs = 0
        capture.start(beforeStart: { handoffs += 1 }) { _, _ in }
        await Task.yield(); recorder.completePreparation()
        for _ in 0..<10 { await Task.yield() }
        capture.finish()
        XCTAssertFalse(capture.canBegin)
        capture.start(beforeStart: { handoffs += 1 }) { _, _ in XCTFail("A second finish cannot replace the first callback") }
        XCTAssertEqual(handoffs, 1)
        for _ in 0..<10 { await Task.yield() }
    }

    func testInterruptedRecordingRetainsOriginalWithoutSubmitting() async {
        let recorder = SuspendedQuickRecorder(), capture = ReaderQuickCapture(recorder: recorder)
        var submissions: [Bool] = []
        capture.start { _, submit in submissions.append(submit) }
        await Task.yield(); recorder.completePreparation()
        for _ in 0..<10 { await Task.yield() }
        capture.finish(send: false)
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(submissions, [false])
        XCTAssertEqual(recorder.finishes, 1)
    }

    func testNavigationSleepsWithoutRemovingPlaybackAndManualCollapseSurvivesWake() {
        var controls = ReaderListeningControls()
        controls.sleepNavigation()
        XCTAssertFalse(controls.navigationVisible)
        XCTAssertTrue(controls.transportExpanded)
        controls.collapseTransport()
        controls.wakeNavigation()
        XCTAssertTrue(controls.navigationVisible)
        XCTAssertFalse(controls.transportExpanded)
        controls.sleepNavigation()
        controls.expandTransport()
        XCTAssertFalse(controls.navigationVisible)
        XCTAssertTrue(controls.transportExpanded)
    }

    func testOnlySavedUnreadAnswerIsReadyAndReadingAnotherTurnCannotClearIt() {
        let tools = ReaderCloudTools()
        tools.quickTargetID = "question"
        tools.turns = [ReaderConversationTurn(id: "question", question: "Explain", answer: nil, status: "running")]
        XCTAssertEqual(tools.quickQuestionStatus, .attention, "A persisted run without a live connection needs reconciliation")
        tools.turns[0].status = "failed"
        XCTAssertEqual(tools.quickQuestionStatus, .attention)
        tools.turns = [ReaderConversationTurn(id: "question", question: "Explain", answer: "Saved answer", status: "completed")]
        XCTAssertEqual(tools.quickQuestionStatus, .ready)
        tools.markQuickAnswerRead("another-turn")
        XCTAssertEqual(tools.quickQuestionStatus, .ready)
        tools.markQuickAnswerRead("question")
        XCTAssertEqual(tools.quickQuestionStatus, .idle)
    }
}

@MainActor private final class SuspendedQuickRecorder: ReaderVoiceRecording {
    var recording = false
    var error: String?
    private var continuation: CheckedContinuation<Void, Never>?
    private var cancelled = false
    var finishes = 0
    var starts = 0
    func start(draft: String, update: @escaping (String) -> Void) async {
        starts += 1; cancelled = false
        await withCheckedContinuation { continuation = $0 }
        guard !cancelled else { return }
        recording = true
    }
    func completePreparation() { continuation?.resume(); continuation = nil }
    func finish() async throws -> ChatRecordedVoice {
        finishes += 1; recording = false
        return ChatRecordedVoice(id: UUID(), url: URL(fileURLWithPath: "/tmp/synthetic-quiet-voice.caf"), durationMs: 1500, transcript: "Explain this sentence")
    }
    @discardableResult func cancel() -> String { cancelled = true; recording = false; return "" }
}

@MainActor private final class WindowPositionHold: UILongPressGestureRecognizer {
    weak var coordinateWindow: UIWindow?
    var windowPoint = CGPoint.zero
    var inputState = UIGestureRecognizer.State.possible
    override var state: UIGestureRecognizer.State {
        get { inputState }
        set { inputState = newValue }
    }
    override func location(in view: UIView?) -> CGPoint {
        guard let view else { return windowPoint }
        return view.convert(windowPoint, from: coordinateWindow)
    }
}
