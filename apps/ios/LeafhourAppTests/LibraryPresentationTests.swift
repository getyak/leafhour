import XCTest
import LeafhourCore
@testable import Leafhour

final class LibraryPresentationTests: XCTestCase {
    private func local(_ id: String, title: String, author: String = "", added: TimeInterval = 1, cloudID: String? = nil, version: String = "v1") throws -> LocalBook {
        var json: [String: Any] = [
            "id": id, "title": title, "author": author, "kind": "txt", "sourceVersion": "fixture",
            "originalFilename": "fixture.txt", "importedAt": added, "chapters": []
        ]
        if let cloudID {
            json["cloud"] = ["ownerID": "isolated-fixture", "bookID": cloudID, "contentVersion": version, "sourceFormat": "txt"]
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return try decoder.decode(LocalBook.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private func cloud(_ id: String, title: String, added: TimeInterval? = nil) -> CloudShelfBook {
        var book = CloudShelfBook(id: id, title: title, author: "", contentVersion: "v1")
        book.addedAt = added.map(Date.init(timeIntervalSince1970:))
        return book
    }

    func testDownloadedBookAndNewerCloudVersionRemainOneReadableItem() throws {
        let saved = try local("device-book", title: "A Book", cloudID: "cloud-book")
        let remote = CloudShelfBook(id: "cloud-book", title: "A Book", author: "", contentVersion: "v2")
        let items = LibraryPresentation.items(local: [saved], cloud: [remote])
        XCTAssertEqual(items.map(\.id), ["cloud:cloud-book"])
        XCTAssertEqual(items.first?.local?.id, "device-book")
        XCTAssertTrue(try XCTUnwrap(items.first).hasCloudUpdate)
    }

    func testOlderOfflineVersionRemainsReachableAfterDownloadingAnUpdatedCopy() throws {
        let older = try local("older-copy", title: "A Book", added: 1, cloudID: "cloud-book", version: "v1")
        let current = try local("current-copy", title: "A Book", added: 2, cloudID: "cloud-book", version: "v2")
        let remote = CloudShelfBook(id: "cloud-book", title: "A Book", author: "", contentVersion: "v2")
        let items = LibraryPresentation.items(local: [older, current], cloud: [remote])
        XCTAssertEqual(Set(items.compactMap { $0.local?.id }), Set(["older-copy", "current-copy"]), "Each source version needs an entry to its own notes, drafts and export")
        XCTAssertEqual(items.first { $0.id == "cloud:cloud-book" }?.local?.id, "current-copy")
        XCTAssertEqual(Set(items.map(\.id)).count, 2)
    }

    func testDownloadedFilterExcludesCloudOnlyBookWithoutChangingTheLibrary() throws {
        let saved = try local("device-book", title: "Available Offline")
        let remote = CloudShelfBook(id: "remote", title: "Needs Download", author: "", contentVersion: "v1")
        let items = LibraryPresentation.items(local: [saved], cloud: [remote], filter: .downloaded)
        XCTAssertEqual(items.map(\.title), ["Available Offline"])
        XCTAssertTrue(try XCTUnwrap(items.first).isDownloaded)
    }

    func testSearchTrimsWhitespaceAndMatchesAuthorWithoutCaseOrAccentSensitivity() throws {
        let saved = try local("one", title: "A Book", author: "José Alvarez")
        let remote = CloudShelfBook(id: "two", title: "Other", author: "Another Writer", contentVersion: "v1")
        XCTAssertEqual(LibraryPresentation.items(local: [saved], cloud: [remote], query: "  JOSE  ").map(\.title), ["A Book"])
        XCTAssertEqual(LibraryPresentation.items(local: [saved], cloud: [remote], query: "other").map(\.title), ["Other"])
        XCTAssertTrue(LibraryPresentation.items(local: [saved], cloud: [remote], query: "missing").isEmpty)
    }

    func testTitleSortUsesNaturalNumbersAndDeterministicTieBreaks() {
        let books = [
            CloudShelfBook(id: "ten", title: "Book 10", author: "", contentVersion: "v1"),
            CloudShelfBook(id: "two", title: "Book 2", author: "", contentVersion: "v1"),
            CloudShelfBook(id: "one", title: "Book 1", author: "", contentVersion: "v1")
        ]
        XCTAssertEqual(LibraryPresentation.items(local: [], cloud: books, sort: .title).map(\.title), ["Book 1", "Book 2", "Book 10"])
    }

    func testAuthorSortPlacesKnownAuthorsBeforeUnknownAndBreaksTiesByTitle() {
        let books = [
            CloudShelfBook(id: "unknown", title: "First", author: "", contentVersion: "v1"),
            CloudShelfBook(id: "b", title: "Second", author: "Baker", contentVersion: "v1"),
            CloudShelfBook(id: "a2", title: "Book 2", author: "Adams", contentVersion: "v1"),
            CloudShelfBook(id: "a1", title: "Book 1", author: "Adams", contentVersion: "v1")
        ]
        XCTAssertEqual(LibraryPresentation.items(local: [], cloud: books, sort: .author).map(\.title), ["Book 1", "Book 2", "Second", "First"])
    }

    func testAddedOrderUsesActualDeviceDatesAndPreservesCloudOrderWhenDatesAreUnavailable() throws {
        let older = try local("old", title: "Older", added: 1)
        let newer = try local("new", title: "Newer", added: 2)
        let remote = [
            CloudShelfBook(id: "z", title: "Cloud Z", author: "", contentVersion: "v1"),
            CloudShelfBook(id: "a", title: "Cloud A", author: "", contentVersion: "v1")
        ]
        XCTAssertEqual(LibraryPresentation.items(local: [older, newer], cloud: remote).map(\.title), ["Newer", "Older", "Cloud Z", "Cloud A"])
    }

    func testNewestCloudArrivalPrecedesOlderSavedAndCloudBooksEvenAtEndOfServiceOrder() throws {
        let saved = try local("saved", title: "Saved", added: 20)
        let remote = [cloud("older", title: "Older cloud", added: 10), cloud("new", title: "New arrival", added: 30)]
        XCTAssertEqual(LibraryPresentation.items(local: [saved], cloud: remote).map(\.id), ["cloud:new", "local:saved", "cloud:older"])
    }

    func testPairedDownloadedBookUsesCloudAdditionDateBeforeDeviceImportDate() throws {
        let paired = try local("downloaded", title: "Downloaded recently", added: 100, cloudID: "paired")
        let saved = try local("saved", title: "Added later", added: 20)
        let remote = [cloud("paired", title: "Downloaded recently", added: 10), cloud("new", title: "New arrival", added: 30)]
        XCTAssertEqual(LibraryPresentation.items(local: [paired, saved], cloud: remote).map(\.id), ["cloud:new", "local:saved", "cloud:paired"])
    }

    func testUnknownCloudDatesKeepServiceOrderAfterDatedBooksAndEqualDatesStayStable() throws {
        let saved = try local("saved", title: "Saved", added: 20)
        let remote = [
            cloud("z", title: "Unknown Z"), cloud("equal-z", title: "Equal Z", added: 30),
            cloud("a", title: "Unknown A"), cloud("equal-a", title: "Equal A", added: 30)
        ]
        XCTAssertEqual(LibraryPresentation.items(local: [saved], cloud: remote).map(\.id), ["cloud:equal-z", "cloud:equal-a", "local:saved", "cloud:z", "cloud:a"])
    }

    func testAddedOrderKeepsAdditionalLocalCopiesAndFallsBackWhenCloudDateIsUnknown() throws {
        let additional = try local("old-copy", title: "Older copy", added: 40, cloudID: "paired", version: "v0")
        let current = try local("current-copy", title: "Current copy", added: 30, cloudID: "paired")
        let remote = [cloud("paired", title: "Current copy"), cloud("new", title: "New arrival", added: 50)]
        let items = LibraryPresentation.items(local: [additional, current], cloud: remote)
        XCTAssertEqual(items.map(\.id), ["cloud:new", "local:old-copy", "cloud:paired"])
        XCTAssertTrue(try XCTUnwrap(items.first { $0.id == "local:old-copy" }).isAdditionalVersion)
        XCTAssertEqual(items.first { $0.id == "cloud:paired" }?.local?.id, "current-copy")
    }

    func testCloudArrivalKeepsPinsSearchAndDownloadedFilter() throws {
        let saved = try local("saved", title: "Saved match", added: 20)
        let paired = try local("paired-copy", title: "Paired match", added: 100, cloudID: "paired")
        let remote = [cloud("paired", title: "Paired match", added: 10), cloud("new", title: "New match", added: 30)]
        let pins: Set<String> = ["cloud:paired"]
        XCTAssertEqual(LibraryPresentation.items(local: [saved, paired], cloud: remote, query: " MATCH ", pinnedIDs: pins).map(\.id), ["cloud:paired", "cloud:new", "local:saved"])
        XCTAssertEqual(LibraryPresentation.items(local: [saved, paired], cloud: remote, query: "match", filter: .downloaded, pinnedIDs: pins).map(\.id), ["cloud:paired", "local:saved"])
        XCTAssertEqual(LibraryPresentation.items(local: [saved, paired], cloud: remote, query: "new", filter: .downloaded, pinnedIDs: pins).map(\.id), [])
    }

    func testPinnedBooksKeepNaturalSortWithinEachGroupAndRemainAccountScoped() throws {
        let books = [CloudShelfBook(id: "b", title: "Book 2", author: "", contentVersion: "v1"), CloudShelfBook(id: "a", title: "Book 1", author: "", contentVersion: "v1"), CloudShelfBook(id: "c", title: "Book 3", author: "", contentVersion: "v1")]
        var pins = LibraryShelfPins()
        pins.set(["cloud:c", "cloud:b"], pinned: true, owner: "account-a")
        pins = try JSONDecoder().decode(LibraryShelfPins.self, from: JSONEncoder().encode(pins))
        XCTAssertEqual(LibraryPresentation.items(local: [], cloud: books, sort: .title, pinnedIDs: pins.ids(owner: "account-a")).map(\.title), ["Book 2", "Book 3", "Book 1"])
        XCTAssertTrue(pins.ids(owner: "account-b").isEmpty)
        XCTAssertTrue(pins.ids(owner: "device").isEmpty)
        pins.set(["cloud:c"], pinned: false, owner: "account-a")
        XCTAssertEqual(pins.ids(owner: "account-a"), ["cloud:b"])
    }

    func testBookRecommendationContainsOnlyTitleAndAuthor() throws {
        let book = try local("private-device-id", title: "Book title", author: "Book author", cloudID: "private-cloud-id")
        let item = try XCTUnwrap(LibraryPresentation.items(local: [book], cloud: []).first)
        XCTAssertEqual(item.shareText, "Book title\nBook author")
        XCTAssertFalse(item.shareText.contains("private-"))
        XCTAssertFalse(item.sourceShareText.contains("isolated-fixture"))
        XCTAssertFalse(item.sourceShareText.contains("sourceVersion"))
    }

    private func snapshot(_ archived: Bool = true, order: [String] = ["b", "a"]) throws -> CloudShelfSnapshot {
        let row: [String: Any] = ["bookId": "a", "contentVersion": "v1", "title": "A", "readingStateReady": true, "journey": ["status": "finished"], "createdAt": "2026-11-01T10:00:00Z", "visibility": "private"]
        let other: [String: Any] = ["bookId": "b", "contentVersion": "v1", "title": "B", "readingStateReady": true, "journey": ["status": "reading"], "createdAt": "2026-10-01T10:00:00Z", "visibility": "private"]
        let wire: [String: Any] = ["kind": "leafhour-account-shelf-v1", "user": ["id": "fixture"], "shelfRevision": 1, "shelf": ["revision": 1, "order": order, "archived": archived ? ["a": "2026-11-01T12:00:00Z"] : [:], "pinned": [], "pinsInitialized": true], "books": archived ? [other] : [row, other], "archivedBooks": archived ? [row] : []]
        return try CloudShelfSnapshot(json: CloudJSON.decode(JSONSerialization.data(withJSONObject: wire)), ownerID: "fixture")
    }

    func testAuthoritativeArchiveHidesDownloadedCopiesWithoutRemovingTheirRecoveryEntry() throws {
        let book = try local("downloaded", title: "Saved A", cloudID: "a")
        let shelf = try snapshot()
        XCTAssertEqual(LibraryPresentation.items(local: [book], cloud: shelf.books, snapshot: shelf).map(\.id), ["cloud:b"])
        let hidden = LibraryPresentation.items(local: [book], cloud: shelf.books, filter: .archived, snapshot: shelf)
        XCTAssertEqual(hidden.map(\.id), ["cloud:a"])
        XCTAssertEqual(hidden.first?.local?.id, book.id)
        XCTAssertTrue(try XCTUnwrap(hidden.first).isDownloaded)
        XCTAssertEqual(LibraryPresentation.items(local: [book], cloud: []).first?.local?.id, book.id, "Legacy absence must retain downloaded books")
    }

    func testAccountManualOrderOverridesAdditionDatesAndFinishedIsDerivedFromReadyMetadata() throws {
        let shelf = try snapshot(false)
        XCTAssertEqual(LibraryPresentation.items(local: [], cloud: shelf.books, snapshot: shelf).map(\.id), ["cloud:b", "cloud:a"])
        XCTAssertEqual(LibraryPresentation.items(local: [], cloud: shelf.books, filter: .finished, snapshot: shelf).map(\.id), ["cloud:a"])
        XCTAssertEqual(LibraryPresentation.items(local: [], cloud: shelf.books, filter: .unread, snapshot: shelf).map(\.id), ["cloud:b"])
    }

    func testRecentSortUsesLocalActivityWithoutInventingItFromImportDates() throws {
        let imported = try local("new-import", title: "New import", added: 100)
        let read = try local("read", title: "Actually read", added: 1)
        XCTAssertEqual(LibraryPresentation.items(local: [imported, read], cloud: [], sort: .recent, localActivity: [read.id: Date(timeIntervalSince1970: 10)]).map(\.id), ["local:read", "local:new-import"])
        let activity = [read.id: Date(timeIntervalSince1970: 10)]
        XCTAssertEqual(LibraryPresentation.items(local: [imported, read], cloud: [], filter: .reading, localActivity: activity).map(\.id), ["local:read"])
        XCTAssertEqual(LibraryPresentation.items(local: [imported, read], cloud: [], filter: .unread, localActivity: activity).map(\.id), ["local:new-import"])
        XCTAssertTrue(LibraryPresentation.items(local: [imported, read], cloud: [], filter: .finished, localActivity: activity).isEmpty)
    }

    func testLegacyPinMigrationCannotOverrideInitializedCloudPinsOrPendingIntent() {
        var pins = LibraryShelfPins()
        pins.set(["cloud:a", "cloud:missing", "local:device-book"], pinned: true, owner: "owner")
        XCTAssertEqual(pins.cloudMigrationIDs(owner: "owner", available: ["a"], pinsInitialized: false, hasPendingPins: false), ["a"])
        XCTAssertTrue(pins.cloudMigrationIDs(owner: "owner", available: ["a"], pinsInitialized: true, hasPendingPins: false).isEmpty)
        XCTAssertTrue(pins.cloudMigrationIDs(owner: "owner", available: ["a"], pinsInitialized: false, hasPendingPins: true).isEmpty)
        XCTAssertEqual(pins.ids(owner: "owner"), ["cloud:a", "cloud:missing", "local:device-book"], "Migration retains the original device preferences")
    }

}
