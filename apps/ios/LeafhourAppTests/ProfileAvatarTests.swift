import XCTest
import UIKit
import ImageIO
@testable import Leafhour

@MainActor final class ProfileAvatarTests: XCTestCase {
    private var directory: URL!
    private var suite: String!
    private var defaults: UserDefaults!
    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        suite = "leafhour-avatar-tests-" + UUID().uuidString
        defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    }
    override func tearDownWithError() throws {
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
        defaults.removePersistentDomain(forName: suite)
    }
    func testChoiceSurvivesRelaunchWithoutCrossingAccountOrDeviceScope() throws {
        let a = "isolated-account-a", b = "isolated-account-b"
        let store = ProfileAvatarStore(defaults: defaults, directory: directory)
        let bDefault = store.choice(b), deviceDefault = store.choice("device")
        store.select("avatar-shapes-2", owner: a)
        let relaunched = ProfileAvatarStore(defaults: defaults, directory: directory)
        XCTAssertEqual(relaunched.choice(a), "avatar-shapes-2")
        XCTAssertEqual(relaunched.choice(b), bDefault)
        XCTAssertEqual(relaunched.choice("device"), deviceDefault)
        relaunched.select("../../not-an-avatar", owner: a)
        XCTAssertEqual(relaunched.choice(a), "avatar-shapes-2")
        relaunched.useDefault(owner: a)
        XCTAssertEqual(relaunched.choice(a), ProfileAvatarStore.defaultPreset(a))
        XCTAssertFalse(defaults.dictionaryRepresentation().keys.contains { $0.contains(a) })
    }
    func testPhotoImportDownsamplesAndRemovesMetadataBeforePersistence() throws {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: 2000, height: 1000), format: format).image { context in
            UIColor.red.setFill(); context.fill(CGRect(x: 0, y: 0, width: 2000, height: 1000))
        }
        let raw = try XCTUnwrap(image.jpegData(compressionQuality: 1)), mutable = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(mutable, "public.jpeg" as CFString, 1, nil))
        let cg = try XCTUnwrap(image.cgImage)
        CGImageDestinationAddImage(destination, cg, [kCGImagePropertyGPSDictionary: [kCGImagePropertyGPSLatitude: 12.34, kCGImagePropertyGPSLatitudeRef: "N"]] as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(destination)); XCTAssertGreaterThan(raw.count, 0)
        let jpeg = try ProfileAvatarStore.photoThumbnail(mutable as Data)
        let source = try XCTUnwrap(CGImageSourceCreateWithData(jpeg as CFData, nil))
        let metadata = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any])
        XCTAssertEqual(metadata[kCGImagePropertyPixelWidth as String] as? Int, 384)
        XCTAssertEqual(metadata[kCGImagePropertyPixelHeight as String] as? Int, 384)
        XCTAssertNil(metadata[kCGImagePropertyGPSDictionary as String])
        let store = ProfileAvatarStore(defaults: defaults, directory: directory)
        try store.savePhoto(jpeg, owner: "account-a")
        let relaunched = ProfileAvatarStore(defaults: defaults, directory: directory)
        XCTAssertEqual(relaunched.choice("account-a"), "photo")
        XCTAssertEqual(relaunched.image("account-a")?.size.width, 384)
        XCTAssertNotEqual(relaunched.choice("account-b"), "photo")
    }
    func testUnreadablePhotoDoesNotReplaceTheExistingChoice() throws {
        let store = ProfileAvatarStore(defaults: defaults, directory: directory)
        store.select("avatar-thumbs-4", owner: "account-a")
        XCTAssertThrowsError(try ProfileAvatarStore.photoThumbnail(Data("bad-image".utf8)))
        XCTAssertEqual(store.choice("account-a"), "avatar-thumbs-4")
    }
    func testEveryCuratedAvatarIsBundledAndDefaultIsDeterministic() {
        XCTAssertEqual(ProfileAvatarStore.defaultPreset("one-owner"), ProfileAvatarStore.defaultPreset("one-owner"))
        for name in ProfileAvatarStore.presets { XCTAssertNotNil(UIImage(named: name), name) }
    }
}
