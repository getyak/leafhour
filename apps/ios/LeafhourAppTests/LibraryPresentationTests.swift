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

}
