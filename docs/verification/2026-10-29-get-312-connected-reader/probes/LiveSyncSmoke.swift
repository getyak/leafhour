import Foundation
import CryptoKit
import LeafhourCore

private struct StageFailure: Error { var code: String }

@main struct LiveSyncSmoke {
    static let root = URL(fileURLWithPath: "/private/tmp/ai-test-GET-312.OHEJ7B")
    static let expectedEmail = "test@cubxxw.com"
    static func require(_ condition: @autoclosure () -> Bool, _ code: String) throws { if !condition() { throw StageFailure(code: code) } }
    static func json(_ client: CloudLibraryClient, _ path: String, owner: String, body: [String: CloudJSON]? = nil) async throws -> CloudJSON {
        try CloudJSON.decode(await client.data(path: path, method: body == nil ? "GET" : "POST", body: body.map { try CloudJSON.encode($0) }, ownerID: owner))
    }
    static func keychainPassword() throws -> String {
        let process = Process(), pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/security")
        process.arguments = ["find-generic-password", "-s", "com.cubxxw.agents.default-data-workspace", "-a", expectedEmail, "-w"]
        process.standardOutput = pipe; process.standardError = FileHandle.nullDevice
        try process.run()
        let bytes = pipe.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
        guard process.terminationStatus == 0, let password = String(data: bytes, encoding: .utf8), !password.isEmpty else { throw StageFailure(code: "keychain-unavailable") }
        return password.trimmingCharacters(in: .newlines)
    }
    static func main() async {
        let client = CloudLibraryClient()
        let marker = "GET312-2026-10-29-" + UUID().uuidString.lowercased()
        let filename = marker + ".md"
        let text = "# " + marker + "\n\nThis original public integration fixture belongs only to the GET312 iOS sync check on 2026-10-29. It contains no private reading material.\n\nA quiet leaf marks this isolated test. The uploaded file, synthetic note, and reading position are archived together after verification. Marker: " + marker + ".\n"
        let bytes = Data(text.utf8)
        let sourceHash = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        var stage = "login", status = "failed", cleanup = "not-created"
        var account: CloudAccount?, createdBookID: String?, createdVersion: String?
        var report: [String: Any] = ["test":"GET-312-production-swift-sync", "date":"2026-10-29", "modelRequests":0]
        do {
            let authenticated = try await client.signIn(email: expectedEmail, password: keychainPassword())
            try require(authenticated.email == expectedEmail && UUID(uuidString: authenticated.id) != nil, "unexpected-account")
            account = authenticated; report["accountMatches"] = true
            stage = "upload-original"
            let uploaded = try await client.uploadOriginal(bytes, filename: filename, ownerID: authenticated.id)
            guard let id = uploaded["bookId"].string, let version = uploaded["contentVersion"].string else { throw StageFailure(code: "missing-upload-receipt") }
            createdBookID = id; createdVersion = version; cleanup = "pending"
            try require(uploaded["source"]["sha256"].string == sourceHash && uploaded["source"]["filename"].string == filename, "source-receipt-mismatch")
            let recovery: [String: String] = ["bookId":id,"contentVersion":version,"sourceHash":sourceHash,"filename":filename,"marker":marker]
            try JSONSerialization.data(withJSONObject: recovery, options: .sortedKeys).write(to: root.appendingPathComponent("live-sync-resource-reference.json"), options: .atomic)
            report["uploadVerified"] = true
            let path = "/api/library/books/" + CloudJSON.component(id)
            stage = "download-and-import"
            let remote = CloudShelfBook(id: id, title: marker, author: "", contentVersion: version)
            let copy = try await client.downloadReadingCopy(remote, ownerID: authenticated.id)
            try require(copy.identity.ownerID == authenticated.id && copy.identity.bookID == id && copy.identity.contentVersion == version, "copy-identity-mismatch")
            let library = try OfflineLibrary(root: root.appendingPathComponent("live-sync-library"), scope: .account(UUID(uuidString: authenticated.id)!))
            let local = try await library.importCloud(copy)
            let verified = try await library.verify(local.id)
            try require(verified, "offline-manifest-mismatch")
            report["downloadedChapters"] = copy.chapters.count
            report["downloadedPassages"] = copy.chapters.reduce(0) { $0 + $1.passages.count }
            guard let chapter = local.chapters.first(where: { $0.passages.contains(where: { $0.text.contains("This original public integration fixture") }) }),
                  let passage = chapter.passages.first(where: { $0.text.contains("This original public integration fixture") }) else { throw StageFailure(code: "fixture-passage-unavailable") }
            let anchor = ReadingAnchor(chapterID: chapter.id, passageID: passage.id)
            let noteID = UUID(), noteBody = "Synthetic original note for " + marker + ". Only this isolated fixture is used."
            var state = ReaderState(); state.anchor = anchor
            state.notes = [ReaderNote(id: noteID, anchor: anchor, quote: passage.text, body: noteBody)]
            try await library.saveState(state, bookID: local.id)
            let sync = CloudBookSync(client: client, library: library)
            stage = "push-note-and-position"
            try await sync.synchronize(local.id)
            let saved = try await json(client, path + "/records", owner: authenticated.id)
            let ownRows = saved["comments"].array.filter { $0["id"].string?.lowercased() == noteID.uuidString.lowercased() }
            try require(ownRows.count == 1 && ownRows[0]["text"].string == noteBody, "note-push-unconfirmed")
            try require(saved["position"]["chapterId"].string == chapter.id && saved["position"]["passageId"].string == passage.id, "position-push-unconfirmed")
            report["noteCountAfterPush"] = ownRows.count; report["positionPushVerified"] = true
            stage = "retry-idempotence"
            try await sync.synchronize(local.id); try await sync.synchronize(local.id)
            let retried = try await json(client, path + "/records", owner: authenticated.id)
            let retryRows = retried["comments"].array.filter { $0["id"].string?.lowercased() == noteID.uuidString.lowercased() }
            try require(retryRows.count == 1, "duplicate-note-after-retry")
            report["noteCountAfterRetry"] = retryRows.count
            stage = "remote-edit-pull"
            let editedBody = "Edited synthetic original note for " + marker + ". The native copy must receive this edit."
            _ = try await json(client, path + "/comments/" + CloudJSON.component(noteID.uuidString.lowercased()) + "/edit", owner: authenticated.id, body: ["text":.string(editedBody),"contentVersion":.string(version),"baseRevision":.number(retryRows[0]["revision"].number ?? 0),"editId":.string(UUID().uuidString.lowercased())])
            try await sync.synchronize(local.id)
            let editedState = try await library.state(local.id)
            try require(editedState.notes.first(where: { $0.id == noteID })?.body == editedBody, "remote-edit-not-pulled")
            report["remoteEditPulled"] = true
            stage = "position-conflict"
            var moved = editedState; moved.anchor = ReadingAnchor(chapterID: chapter.id, passageID: passage.id, characterOffset: 8)
            try await library.saveState(moved, bookID: local.id)
            let current = try await json(client, path + "/records", owner: authenticated.id)
            let otherPosition = try await json(client, path + "/progress", owner: authenticated.id, body: ["chapterId":.string(chapter.id),"passageId":.string(passage.id),"offset":.number(0),"withinParagraph":.number(0.6),"mode":.string("en"),"variant":.string("literal"),"baseRevision":.number(current["position"]["revision"].number ?? 0)])
            try await sync.synchronize(local.id)
            let conflict = try await library.cloudMetadata(local.id), conflictState = try await library.state(local.id)
            try require(conflict.positionConflict && conflictState.anchor == moved.anchor, "position-conflict-not-preserved")
            try await sync.resolvePosition(local.id, useDevice: false)
            let resolved = try await library.state(local.id), resolvedMetadata = try await library.cloudMetadata(local.id)
            try require(!resolvedMetadata.positionConflict && resolved.anchor == CloudBookSync.anchor(otherPosition, book: local), "position-conflict-not-resolved")
            report["positionConflictPreserved"] = true; report["positionConflictResolved"] = true
            status = "passed"; stage = "verified"
        } catch {
            report["failureStage"] = stage
            report["errorType"] = String(describing: type(of: error))
            if let request = error as? CloudRequestError { report["httpStatus"] = request.status }
            if let failure = error as? StageFailure { report["failureCode"] = failure.code }
        }
        if let account, let id = createdBookID, let version = createdVersion {
            let prior = stage
            do {
                stage = "cleanup-verify-account"
                let session = try CloudJSON.decode(await client.data(path: "/api/auth/session"))
                try require(session["user"]["id"].string == account.id && session["user"]["email"].string == expectedEmail, "cleanup-account-mismatch")
                let path = "/api/library/books/" + CloudJSON.component(id)
                let actual = try await json(client, path, owner: account.id)
                try require(actual["bookId"].string == id && actual["contentVersion"].string == version && actual["source"]["sha256"].string == sourceHash && actual["source"]["filename"].string == filename, "cleanup-source-mismatch")
                stage = "cleanup-archive"
                var archived = false
                for attempt in 0..<3 {
                    let shelf = try await json(client, "/api/library?view=books", owner: account.id)
                    try require(shelf["user"]["id"].string == account.id, "cleanup-shelf-owner-mismatch")
                    guard let revision = shelf["shelfRevision"].number else { throw StageFailure(code: "cleanup-shelf-revision-missing") }
                    do { _ = try await json(client, path + "/archive", owner: account.id, body: ["baseRevision":.number(revision)]); archived = true; break }
                    catch let error as CloudRequestError where error.status == 409 && attempt < 2 { continue }
                }
                try require(archived, "cleanup-archive-unconfirmed")
                stage = "cleanup-readback"
                let active = try await json(client, "/api/library?view=books", owner: account.id)
                let trash = try await json(client, "/api/library/trash", owner: account.id)
                try require(!active["books"].array.contains(where: { $0["bookId"].string == id }) && trash["books"].array.contains(where: { $0["bookId"].string == id }), "cleanup-readback-mismatch")
                cleanup = "archived-verified"; stage = prior
            } catch {
                cleanup = "failed-" + stage
                report["cleanupErrorType"] = String(describing: type(of: error))
                if let request = error as? CloudRequestError { report["cleanupHTTPStatus"] = request.status }
                if let failure = error as? StageFailure { report["cleanupFailureCode"] = failure.code }
                status = "failed"
            }
        }
        await client.signOut()
        report["status"] = status; report["stage"] = stage; report["cleanup"] = cleanup
        if status == "passed" { report["completedChecks"] = 8 }
        do { try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys,.prettyPrinted]).write(to: root.appendingPathComponent("live-sync-result.json"), options: .atomic) }
        catch { status = "failed" }
        let output: [String: Any] = ["status":status,"stage":stage,"cleanup":cleanup,"checks":report["completedChecks"] ?? 0]
        print(String(data: (try? JSONSerialization.data(withJSONObject: output, options:.sortedKeys)) ?? Data(), encoding:.utf8) ?? "{}")
        if status != "passed" { exit(1) }
    }
}
