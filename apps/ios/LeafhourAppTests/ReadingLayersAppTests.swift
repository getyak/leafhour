import XCTest
import SwiftUI
import UIKit
import ImageIO
import PDFKit
import LeafhourCore
@testable import Leafhour

@MainActor
final class ReadingLayersAppTests: XCTestCase {
    private func fixture() async throws -> ReaderSession {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("source.txt")
        try Data("Original 🌿 passage with stable source words.".utf8).write(to: file)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        var book = try await library.importFile(file)
        book.cloud = CloudBookIdentity(ownerID: "test-owner", bookID: "cloud-book", contentVersion: "v1", sourceFormat: "txt")
        return ReaderSession(book: book, state: try await library.state(book.id), original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), library: library)
    }
    func testRemoteWebPReallyDecodesToANativeCoverImage() async throws {
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [CoverDecodeProtocol.self]
        let cloud = CloudLibraryClient(baseURL: URL(string:"https://cover.test")!,credential:CloudCredential(account:CloudAccount(id:"cover-owner",email:nil),token:"isolated-cover"),configuration:configuration)
        let resource = BookCoverResource(key:UUID().uuidString,book:nil,path:"/book-covers/probe-640.webp?v="+UUID().uuidString,ownerID:"cover-owner",cloud:cloud,library:nil)
        let image = await resource.load()
        XCTAssertNotNil(image,"The actual transport and ImageIO decoder must yield artwork")
        XCTAssertGreaterThan(image?.size.height ?? 0,0)
    }
    func testActualPublicArtworkDecodesAndTheCoverViewDrawsItsImage() async throws {
        let support = try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true)
        let file = support.appendingPathComponent("GET344CoverFixtures/alice-640.webp")
        guard FileManager.default.fileExists(atPath:file.path) else { throw XCTSkip("Run the declared native cover fixture setup for the real public artwork") }
        let bytes = try Data(contentsOf:file)
        let source = try XCTUnwrap(CGImageSourceCreateWithData(bytes as CFData,nil))
        XCTAssertNotNil(CGImageSourceCreateThumbnailAtIndex(source,0,[kCGImageSourceCreateThumbnailFromImageAlways:true,kCGImageSourceThumbnailMaxPixelSize:840,kCGImageSourceCreateThumbnailWithTransform:true] as CFDictionary))
        CoverDecodeProtocol.overrideData = bytes
        defer { CoverDecodeProtocol.overrideData = nil }
        let configuration=URLSessionConfiguration.ephemeral;configuration.protocolClasses=[CoverDecodeProtocol.self]
        let cloud=CloudLibraryClient(baseURL:URL(string:"https://cover.test")!,credential:CloudCredential(account:CloudAccount(id:"cover-owner",email:nil),token:"isolated-cover"),configuration:configuration)
        let resource=BookCoverResource(key:UUID().uuidString,book:nil,path:"/book-covers/alice-640.webp?v="+UUID().uuidString,ownerID:"cover-owner",cloud:cloud,library:nil)
        let image=await resource.load();XCTAssertNotNil(image)
        let item=LibraryShelfItem(id:"fixture",local:nil,cloud:CloudShelfBook(id:"fixture",title:"Fixture",author:"",contentVersion:"v1"))
        let grid=ScrollView { LazyVGrid(columns:[GridItem(.flexible())]) { LibraryShelfTile(item:item,downloadUnavailable:false,resource:resource,open:{},details:{}) } }.frame(width:180)
        let host=UIHostingController(rootView:grid)
        let window=UIWindow(frame:CGRect(x:0,y:0,width:180,height:400));window.rootViewController=host;window.makeKeyAndVisible()
        defer { window.isHidden=true;window.rootViewController=nil }
        host.view.frame=window.bounds;host.view.layoutIfNeeded()
        try await Task.sleep(for:.milliseconds(200))
        let snapshot=UIGraphicsImageRenderer(size:window.bounds.size).image { _ in host.view.drawHierarchy(in:host.view.bounds,afterScreenUpdates:true) }
        let cg=try XCTUnwrap(snapshot.cgImage)
        let crop=try XCTUnwrap(cg.cropping(to:CGRect(x:CGFloat(cg.width)/3,y:CGFloat(cg.width)*0.7,width:CGFloat(cg.width)/3,height:CGFloat(cg.width)/4)))
        var pixels=[UInt8](repeating:0,count:16*16*4)
        let context=try XCTUnwrap(CGContext(data:&pixels,width:16,height:16,bitsPerComponent:8,bytesPerRow:64,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue))
        context.draw(crop,in:CGRect(x:0,y:0,width:16,height:16))
        XCTAssertGreaterThan(Set(stride(from:0,to:pixels.count,by:4).map { "\(pixels[$0]),\(pixels[$0+1]),\(pixels[$0+2])" }).count,24)
    }
    func testImageOnlyPDFKeepsItsOriginalPageInTranslationAndParallelModes() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        addTeardownBlock { try? FileManager.default.removeItem(at:root) }
        let file=root.appendingPathComponent("image-only.pdf")
        let bytes=UIGraphicsPDFRenderer(bounds:CGRect(x:0,y:0,width:300,height:450)).pdfData { context in
            context.beginPage();UIColor.gray.setFill();context.cgContext.fill(CGRect(x:30,y:30,width:240,height:390))
        };try bytes.write(to:file)
        let library=try OfflineLibrary(root:root.appendingPathComponent("library"),scope:.device)
        let book=try await library.importFile(file)
        var state=try await library.state(book.id);state.preferences.viewMode = .translation
        let session=ReaderSession(book:book,state:state,original:file,directory:try await library.bookDirectory(book.id),library:library)
        let host=UIHostingController(rootView:ReaderScreen(session:session,systemColorScheme:.light,library:library))
        let window=UIWindow(frame:CGRect(x:0,y:0,width:375,height:812));window.rootViewController=host;window.makeKeyAndVisible()
        defer { window.isHidden=true;window.rootViewController=nil }
        func containsPDF(_ view:UIView)->Bool { view is PDFView || view.subviews.contains(where:containsPDF) }
        try await Task.sleep(for:.milliseconds(40));host.view.layoutIfNeeded()
        XCTAssertTrue(containsPDF(host.view),"A page without text must retain PDFKit's real source instead of an empty translated text view")
        var preferences=session.state.preferences;preferences.viewMode = .parallel;session.changePreferences(preferences)
        try await Task.sleep(for:.milliseconds(40));host.view.layoutIfNeeded()
        XCTAssertTrue(containsPDF(host.view));_ = await session.flush()
    }
    private func renderer(_ session: ReaderSession) -> (UITextView, TextReadingView.Coordinator) {
        let reader = TextReadingView(session: session, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {})
        let coordinator = reader.makeCoordinator()
        let view = UITextView(frame: CGRect(x: 0, y: 0, width: 375, height: 700))
        coordinator.view = view; coordinator.updateContent(view)
        return (view, coordinator)
    }
    func testActualTextRendererShowsIndependentModesAndTranslationSelectionsKeepSourceProvenance() async throws {
        let session = try await fixture(), passage = try XCTUnwrap(session.chapter.passages.first)
        session.updateTranslations([passage.id: ReadingTranslation(original: passage.text, literal: "直译 🌿 独立文本", interpretive: "这是另一种意译。", literalStatus: "draft", interpretiveStatus: "reviewed")])
        let (view, coordinator) = renderer(session)
        XCTAssertTrue(view.text.contains(passage.text)); XCTAssertFalse(view.text.contains("直译 🌿"))
        var preferences = session.state.preferences; preferences.viewMode = .translation
        session.changePreferences(preferences); coordinator.updateContent(view)
        XCTAssertFalse(view.text.contains(passage.text)); XCTAssertTrue(view.text.contains("直译 🌿 独立文本"))
        let range = (view.text as NSString).range(of: "🌿 独立")
        let selection = try XCTUnwrap(coordinator.selectedQuote(in: view, range: range))
        XCTAssertEqual(selection.origin, "translation"); XCTAssertEqual(selection.variant, "literal")
        XCTAssertEqual(selection.anchor.passageID, passage.id); XCTAssertEqual(selection.anchor.characterOffset, 0)
        XCTAssertEqual(selection.sourceText, passage.text)
        preferences.viewMode = .parallel; preferences.translationVariant = .interpretive
        session.changePreferences(preferences); coordinator.updateContent(view)
        XCTAssertTrue(view.text.contains(passage.text)); XCTAssertTrue(view.text.contains("这是另一种意译。")); XCTAssertFalse(view.text.contains("直译 🌿"))
        XCTAssertEqual(coordinator.spans.map { $0.passage.id }, [passage.id, passage.id])
        XCTAssertEqual(coordinator.spans.map(\.isTranslation), [false, true])
    }
    func testAsyncTranslationRefreshKeepsTheVisibleWordsInsideALongTranslatedParagraph() async throws {
        let session = try await fixture(), passage = try XCTUnwrap(session.chapter.passages.first)
        let translation = (1...200).map { "编号\($0) 这一段译文可以连续阅读。" }.joined(separator: " ")
        var preferences = session.state.preferences; preferences.viewMode = .translation; session.changePreferences(preferences)
        session.updateTranslations([passage.id: ReadingTranslation(original:passage.text,literal:translation,literalStatus:"draft")])
        let (view, coordinator) = renderer(session)
        try await Task.sleep(for:.milliseconds(30))
        view.layoutManager.ensureLayout(for:view.textContainer)
        let word = (view.text as NSString).range(of:"编号80")
        let glyph = view.layoutManager.glyphRange(forCharacterRange:word,actualCharacterRange:nil)
        let rect = view.layoutManager.boundingRect(forGlyphRange:glyph,in:view.textContainer)
        view.setContentOffset(CGPoint(x:0,y:rect.minY+view.textContainerInset.top-64),animated:false)
        coordinator.restoring = false; coordinator.capture()
        let before = view.contentOffset.y
        XCTAssertGreaterThan(before,200)
        session.updateTranslations([passage.id: ReadingTranslation(original:passage.text,literal:translation,literalStatus:"reviewed")])
        coordinator.updateContent(view)
        try await Task.sleep(for:.milliseconds(30))
        XCTAssertLessThan(abs(view.contentOffset.y-before),50,"A saved translation update must keep the reader's visible words, while the persisted source offset remains a paragraph anchor")
        XCTAssertEqual(session.currentAnchor?.characterOffset,0)
    }
    func testTranslationUpdateWaitsUntilNativeSelectionEnds() async throws {
        let session = try await fixture(), passage = try XCTUnwrap(session.chapter.passages.first)
        var preferences = session.state.preferences; preferences.viewMode = .translation; session.changePreferences(preferences)
        session.updateTranslations([passage.id: ReadingTranslation(original:passage.text,literal:"选中的译文保持可复制。",literalStatus:"draft")])
        let (view, coordinator) = renderer(session)
        try await Task.sleep(for:.milliseconds(30))
        let range = (view.text as NSString).range(of:"选中的译文")
        view.selectedRange = range
        let selectedContent = view.text
        session.updateTranslations([passage.id: ReadingTranslation(original:passage.text,literal:"选中的译文保持可复制。",literalStatus:"reviewed")])
        coordinator.updateContent(view)
        XCTAssertEqual(view.selectedRange,range); XCTAssertEqual(view.text,selectedContent)
        view.selectedRange = NSRange(location:0,length:0); coordinator.updateContent(view)
        XCTAssertTrue(view.text.contains("已校订"))
    }
    func testChapterSnapshotRejectsWrongSourceBeforeItCanReachReader() async throws {
        let session = try await fixture(), identity = try XCTUnwrap(session.book.cloud), passage = try XCTUnwrap(session.chapter.passages.first)
        let valid = try CloudJSON.decode(JSONSerialization.data(withJSONObject: ["bookId":"cloud-book", "contentVersion":"v1", "chapterId": session.chapter.id, "sections":[["paragraphs":[["id":passage.id,"original":passage.text]]]]]))
        XCTAssertEqual(try ReaderReadingContent.validatedRows(valid, chapter: session.chapter, identity: identity).count, 1)
        var wrong = valid.object; wrong["contentVersion"] = .string("other-version")
        XCTAssertThrowsError(try ReaderReadingContent.validatedRows(.object(wrong), chapter: session.chapter, identity: identity))
        wrong = valid.object; wrong["sections"] = .array([])
        XCTAssertThrowsError(try ReaderReadingContent.validatedRows(.object(wrong), chapter: session.chapter, identity: identity))
    }
    func testDurableRunRetainsExactRequestAndRefusesExpandedScope() async throws {
        let session = try await fixture(), plan = try ReadingTranslationPlan.make(book: session.book, chapterIndex: 0, translations: [:])
        let id = "one-request", body = try CloudJSON.encode(["id":.string(id),"passageId":.string(plan.passageIDs[0]),"contentVersion":.string("v1"),"billing":.object(["idempotencyKey":.string("same-key")])])
        let intent = ReaderGenerationConsent(id: id, title: "翻译", explanation: "scope", path: "/api/library/books/cloud-book/translate", ownerID: "test-owner", body: body, action: "translation", passageID: plan.passageIDs[0])
        let saved = ReaderTranslationRun(plan: plan, pending: intent)
        let restored = try JSONDecoder().decode(ReaderTranslationRun.self, from: JSONEncoder().encode(saved))
        XCTAssertEqual(restored.pending?.body, body); XCTAssertEqual(restored.pending?.id, id)
        XCTAssertNoThrow(try ReaderReadingContent.validate(restored, session: session))
        var invalid = restored; invalid.next = 99
        XCTAssertThrowsError(try ReaderReadingContent.validate(invalid, session: session))
    }
}

private final class CoverDecodeProtocol: URLProtocol, @unchecked Sendable {
    static var overrideData: Data?
    override class func canInit(with request:URLRequest)->Bool { true }
    override class func canonicalRequest(for request:URLRequest)->URLRequest { request }
    override func startLoading() {
        let data=Self.overrideData ?? Data(base64Encoded:"UklGRhgCAABXRUJQVlA4WAoAAAAgAAAAAwAABQAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggKgAAAJABAJ0BKgQABgAAgA4lAE6XQABzAAD+899n/kGPJT0Nbff8W0joUngAAA==")!
        let response=HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:["Content-Type":"image/webp"])!
        client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:data);client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
