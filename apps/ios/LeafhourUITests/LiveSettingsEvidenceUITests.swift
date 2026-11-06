import XCTest

/// Opt-in checks against the saved real test-account session. No fixtures,
/// model submissions, credentials or synthetic account data are provided.
final class LiveSettingsEvidenceUITests: XCTestCase {
    private let app = XCUIApplication()
    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func openSettings() {
        let reader = app.textViews["leafhour-epub-reader"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            reader.exists || self.app.tabBars.buttons["我的阅读"].isHittable
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 35), .completed)
        if reader.exists {
            let back = app.buttons["返回书房"]
            if !back.isHittable { reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap() }
            XCTAssertTrue(back.waitForExistence(timeout: 8)); back.tap()
        }
        app.tabBars.buttons["我的阅读"].tap()
        XCTAssertTrue(app.buttons["journal-settings"].waitForExistence(timeout: 15))
        app.buttons["journal-settings"].tap()
        XCTAssertTrue(app.buttons["settings-account"].waitForExistence(timeout: 10))
    }
    func testRealAccountNameKeyboardAndRelaunch() throws {
        guard ProcessInfo.processInfo.environment["LEAFHOUR_LIVE_GET409"] == "1" else { throw XCTSkip("Explicit real-account acceptance only") }
        continueAfterFailure = false
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch(); defer { app.terminate() }
        openSettings(); capture("GET409-real-settings")
        app.buttons["settings-account"].tap()
        if ProcessInfo.processInfo.environment["LEAFHOUR_LIVE_GET409_RELOGIN"] == "1", app.buttons["account-edit-name"].waitForExistence(timeout: 5) {
            let logout = app.buttons["退出登录"]
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: logout)
            XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 60), .completed)
            logout.tap()
            let confirm = app.sheets.buttons["退出登录"].firstMatch
            XCTAssertTrue(confirm.waitForExistence(timeout: 5)); confirm.tap()
        }
        let email = app.textFields["leafhour-login-email"]
        // Switching to the device library replaces the account-bound sheet.
        // Reopen it once sign-out has completed rather than reading its old tree.
        if !email.waitForExistence(timeout: 5), !app.buttons["account-edit-name"].exists,
           !app.navigationBars["登录"].exists {
            if !app.buttons["settings-account"].exists { openSettings() }
            app.buttons["settings-account"].tap()
        }
        if email.waitForExistence(timeout: 3) {
            guard ProcessInfo.processInfo.environment["LEAFHOUR_LIVE_GET409_PASTE"] == "1" else { XCTFail("The real test account must be signed in"); return }
            email.tap(); email.typeText("test@cubxxw.com")
            let password = app.secureTextFields["leafhour-login-password"]
            XCTAssertTrue(password.waitForExistence(timeout: 5)); password.press(forDuration: 1.2)
            let paste = app.menuItems.matching(NSPredicate(format: "label IN %@", ["Paste", "粘贴", "貼上"])).firstMatch
            XCTAssertTrue(paste.waitForExistence(timeout: 5)); paste.tap()
            app.buttons["leafhour-login-submit"].tap()
            // Successful login closes its sheet. Open account settings again.
            let returned = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                !email.exists && !self.app.navigationBars["登录"].exists && !self.app.navigationBars["账号"].exists
            }, object: nil)
            let returnState = XCTWaiter.wait(for: [returned], timeout: 55)
            if returnState != .completed {
                capture("GET409-real-login-wait")
                let failure = app.staticTexts["leafhour-account-auth-error"]
                XCTFail(failure.exists ? failure.label : "Real login has not returned to settings")
                return
            }
            if !app.buttons["settings-account"].exists { openSettings() }
            app.buttons["settings-account"].tap()
        }
        XCTAssertTrue(app.staticTexts["test@cubxxw.com"].waitForExistence(timeout: 20))
        let edit = app.buttons["account-edit-name"]
        XCTAssertTrue(edit.waitForExistence(timeout: 10)); capture("GET409-real-account")
        let accountForm = app.descendants(matching: .any)["account-settings-form"].firstMatch
        XCTAssertTrue(accountForm.exists)
        XCTAssertFalse(accountForm.buttons["同步书房"].exists, "Account page should not duplicate global sync controls")
        edit.tap()
        let field = app.textFields["account-name-field"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        let original = try XCTUnwrap(field.value as? String)
        XCTAssertFalse(original.isEmpty)
        if let expected = ProcessInfo.processInfo.environment["LEAFHOUR_LIVE_GET409_EXPECTED_NAME"] { XCTAssertEqual(original, expected) }
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        capture("GET409-real-name-keyboard")
        app.buttons["account-name-save"].tap() // Save the existing name unchanged.
        let saved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !field.exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: 30), .completed)
        app.terminate(); app.launch(); openSettings(); app.buttons["settings-account"].tap()
        XCTAssertTrue(app.staticTexts["test@cubxxw.com"].waitForExistence(timeout: 20))
        app.buttons["account-edit-name"].tap()
        XCTAssertTrue(field.waitForExistence(timeout: 10)); XCTAssertEqual(field.value as? String, original)
        capture("GET409-real-name-after-relaunch")
    }
}
