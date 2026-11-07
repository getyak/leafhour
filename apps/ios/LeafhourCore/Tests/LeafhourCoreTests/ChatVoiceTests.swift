import XCTest
@testable import LeafhourCore

final class ChatVoiceTests: XCTestCase {
    func testPendingCaptureSurvivesRecreationAndCannotCrossAccounts() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = UUID(), other = UUID(), id = UUID()
        let library = try OfflineLibrary(root: root, scope: .account(owner))
        let source = root.appendingPathComponent("pending.caf"), bytes = Data("caff-original-awaiting-retention".utf8)
        try bytes.write(to: source)
        let staged = try await library.stageChatVoiceCapture(source, id: id, ownerID: owner.uuidString, metadata: Data("frozen-context-and-transcript".utf8))
        try FileManager.default.removeItem(at: source)
        let reopened = try OfflineLibrary(root: root, scope: .account(owner))
        let pending = try await reopened.pendingChatVoiceCaptures(ownerID: owner.uuidString)
        XCTAssertEqual(pending.count, 1); XCTAssertEqual(pending.first?.id, id)
        XCTAssertEqual(try Data(contentsOf: staged), bytes)
        XCTAssertEqual(pending.first?.metadata, Data("frozen-context-and-transcript".utf8))
        do { _ = try await reopened.pendingChatVoiceCaptures(ownerID: other.uuidString); XCTFail("Foreign account cannot see pending microphone originals") } catch { }
        try await reopened.removeStagedChatVoiceCapture(id: id, ownerID: owner.uuidString)
        let empty = try await reopened.pendingChatVoiceCaptures(ownerID: owner.uuidString)
        XCTAssertTrue(empty.isEmpty)
    }

    func testVoiceCancelRestoresDraftAndSendKeepsTranscript() {
        var state = ChatVoiceComposition()
        state.begin(draft: "原来的草稿")
        XCTAssertEqual(state.transcribe("新说的话"), "原来的草稿\n新说的话")
        XCTAssertEqual(state.cancel(), "原来的草稿")
        XCTAssertFalse(state.isRecording)
        state.begin(draft: "")
        XCTAssertEqual(state.transcribe("第二次录音"), "第二次录音")
        XCTAssertEqual(state.finish(), "第二次录音")
        XCTAssertFalse(state.isRecording)
    }
    func testPartialSpeechReplacesOnlyCurrentRecordingText() {
        var state = ChatVoiceComposition(); state.begin(draft: "已有文字")
        _ = state.transcribe("你好")
        XCTAssertEqual(state.transcribe("你好，世界"), "已有文字\n你好，世界")
        XCTAssertEqual(state.finish(), "已有文字\n你好，世界")
    }
    func testRetainedVoiceIsAccountBoundAndRejectsChangedBytes() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let owner = UUID(), library = try OfflineLibrary(root: directory, scope: .account(owner))
        let source = directory.appendingPathComponent("voice.caf")
        try Data("caff-synthetic-original-recording".utf8).write(to: source)
        let receipt = try await library.retainChatVoice(source, id: UUID(), ownerID: owner.uuidString, durationMs: 500)
        let retained = try await library.chatVoiceURL(receipt, ownerID: owner.uuidString)
        XCTAssertEqual(try Data(contentsOf: retained), try Data(contentsOf: source))
        do { _ = try await library.chatVoiceURL(receipt, ownerID: UUID().uuidString); XCTFail("Other owner must be rejected") } catch { }
        try Data("changed".utf8).write(to: retained)
        do { _ = try await library.chatVoiceURL(receipt, ownerID: owner.uuidString); XCTFail("Changed bytes must fail integrity") } catch { }
    }
}
