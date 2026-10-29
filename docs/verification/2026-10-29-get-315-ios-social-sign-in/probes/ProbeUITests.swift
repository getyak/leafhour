import XCTest
final class SocialAccountProbeTests: XCTestCase {
 let app = XCUIApplication()
 override func setUpWithError() throws { continueAfterFailure=false;app.terminate();app.launch() }
 func capture(_ name:String) { let a=XCTAttachment(screenshot:app.screenshot());a.name=name;a.lifetime = .keepAlways;add(a) }
 func testNativeAuthenticationChoicesAndLinkedMethods() throws {
  XCTAssertTrue(app.buttons["登录书房"].waitForExistence(timeout:15));app.buttons["登录书房"].tap()
  let google=app.buttons["leafhour-login-google"],apple=app.buttons["leafhour-login-apple"]
  XCTAssertTrue(google.waitForExistence(timeout:8));XCTAssertTrue(apple.exists)
  let ready=expectation(for:NSPredicate(format:"enabled == true"),evaluatedWith:google);wait(for:[ready],timeout:8)
  XCTAssertTrue(apple.isEnabled);capture("01-google-apple-native-options")
  let email=app.textFields["leafhour-login-email"],password=app.secureTextFields["leafhour-login-password"]
  for _ in 0..<3 where !email.isHittable { app.swipeUp() }
  XCTAssertTrue(email.isHittable);email.tap();email.typeText("native@example.invalid");password.tap();password.typeText("fixture-only")
  app.buttons["leafhour-login-submit"].tap()
  XCTAssertTrue(app.buttons["我的账号"].waitForExistence(timeout:15));app.buttons["我的账号"].tap()
  XCTAssertTrue(app.staticTexts["Google"].waitForExistence(timeout:8),app.debugDescription)
  XCTAssertFalse(app.buttons["leafhour-link-google"].exists);XCTAssertTrue(app.buttons["leafhour-link-apple"].exists)
  capture("02-linked-methods-same-account")
  try XCTUnwrap(app.buttons.matching(identifier:"我的笔记与阅读记录").allElementsBoundByIndex.first(where: { $0.isHittable })).tap();XCTAssertTrue(app.staticTexts["A note saved on the web."].waitForExistence(timeout:8));capture("03-account-records-preserved")
 }
}
