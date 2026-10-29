import XCTest
final class ConnectedReaderProbeTests: XCTestCase {
 let app = XCUIApplication()
 override func setUpWithError() throws { continueAfterFailure = false; app.terminate(); app.launch() }
 func capture(_ name: String) { let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name=name; attachment.lifetime = .keepAlways; add(attachment) }
 func dock() { if !app.buttons["目录"].exists { app.buttons["显示阅读进度、目录、搜索与记录"].tap() } }
 func testAccountMarkdownAndNativeTools() throws {
  XCTAssertTrue(app.buttons["登录书房"].waitForExistence(timeout:15)); app.buttons["登录书房"].tap()
  let email=app.textFields["leafhour-login-email"],password=app.secureTextFields["leafhour-login-password"]
  XCTAssertTrue(email.waitForExistence(timeout:5));email.tap();email.typeText("native@example.invalid");password.tap();password.typeText("fixture-only")
  capture("01-native-login")
  app.buttons["leafhour-login-submit"].tap()
  let book=app.buttons.containing(.staticText,identifier:"Native Markdown Fixture").firstMatch
  XCTAssertTrue(book.waitForExistence(timeout:15),app.debugDescription);capture("02-account-library")
  app.buttons["我的账号"].tap();app.buttons["我的阅读摘要"].tap()
  XCTAssertTrue(app.staticTexts["A saved reading summary from the web."].waitForExistence(timeout:8),app.debugDescription);capture("02b-saved-reading-summary")
  app.navigationBars.buttons.element(boundBy:0).tap();app.buttons["完成"].tap();book.tap()
  let reader=app.textViews["leafhour-epub-reader"]
  XCTAssertTrue(reader.waitForExistence(timeout:15),app.debugDescription)
  dock();app.buttons["目录"].tap();app.buttons["Chapter one"].tap();dock()
  let value=reader.value as? String ?? ""
  XCTAssertTrue(value.contains("gentle"));XCTAssertFalse(value.contains("**gentle**"));XCTAssertFalse(value.contains("# A quiet"));XCTAssertFalse(value.contains("Only the second chapter"))
  XCTAssertTrue(app.buttons["听书"].exists);XCTAssertTrue(app.buttons["翻译"].exists);capture("03-markdown-native-dock")
  app.buttons["我的记录"].tap();app.buttons.matching(identifier:"回到原句").firstMatch.tap();dock()
  app.buttons["翻译"].tap()
  XCTAssertTrue(app.staticTexts["一页安静的原文，带着强调和咖啡。"].waitForExistence(timeout:8),app.debugDescription)
  if !app.staticTexts["留一点安静，慢慢读下去。"].exists { app.collectionViews.firstMatch.swipeUp() }
  XCTAssertTrue(app.staticTexts["留一点安静，慢慢读下去。"].waitForExistence(timeout:5));XCTAssertFalse(app.staticTexts.matching(NSPredicate(format:"label CONTAINS %@", "暂时无法更新译文")).firstMatch.exists)
  capture("04-distinct-translations")
  app.buttons["继续读"].tap();dock();app.buttons["听书"].tap()
  let play=app.buttons["reader-speech-play"];XCTAssertTrue(play.waitForExistence(timeout:5));XCTAssertEqual(play.label,"从当前段开始朗读");capture("05-native-listening")
  app.buttons["继续读"].tap();dock();app.buttons["我的记录"].tap()
  XCTAssertTrue(app.staticTexts["A note saved on the web."].waitForExistence(timeout:5),app.debugDescription);capture("06-cloud-notes")
  app.buttons["继续读"].tap();dock();app.buttons["目录"].tap();app.buttons["Chapter two"].tap()
  XCTAssertTrue((reader.value as? String ?? "").contains("Only the second chapter"));XCTAssertFalse((reader.value as? String ?? "").contains("A gentle"));capture("07-markdown-second-chapter")
  reader.coordinate(withNormalizedOffset: CGVector(dx:0.5,dy:0.01)).tap();app.buttons["陪我读"].tap()
  let question=app.descendants(matching:.any).matching(identifier:"reader-question").firstMatch
  XCTAssertTrue(question.waitForExistence(timeout:8),app.debugDescription);question.tap();question.typeText("Why this sentence?");capture("08-native-companion-composer")
  app.buttons["继续读"].tap();XCTAssertFalse(question.waitForExistence(timeout:0.5));XCTAssertTrue(reader.exists)
 }
}
