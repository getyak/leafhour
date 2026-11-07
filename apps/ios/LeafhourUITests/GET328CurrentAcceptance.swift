import XCTest
import UIKit

/// Exact opt-in for the coordinated GET-328 follow-up. No arbitrary bundle ID
/// or existing shared QA container can be supplied through the environment.
enum GET328CurrentAcceptance {
    static let bundleIdentifier = "org.leafhour.get328.acceptance20261107"
    static var enabled: Bool {
        switch ProcessInfo.processInfo.environment["LEAFHOUR_GET328_CURRENT_ACCEPTANCE"] {
        case nil: return false
        case "1": return true
        default: preconditionFailure("Unknown GET-328 acceptance opt-in; refusing to launch a QA app")
        }
    }
    static var launchArguments: [String] { enabled ? ["--get328-current-acceptance"] : [] }
    static var sourceDirectoryName: String { enabled ? "GET328AcceptanceSources" : "GET317AcceptanceSources" }
    static var pdfFilename: String { enabled ? "Alice-complete-GET328-20261107.pdf" : "Alice-complete.pdf" }
    static var displayName: String { enabled ? "Leafhour GET328" : "Leafhour" }

    static func application(legacy: Bool = false) -> XCUIApplication {
        if enabled { return XCUIApplication(bundleIdentifier: bundleIdentifier) }
        return legacy ? XCUIApplication(bundleIdentifier: "org.leafhour.get317.testing") : XCUIApplication()
    }

    static func attachRunnerTypeProfile(to testCase: XCTestCase) {
        guard enabled else { return }
        let identifier = Bundle.main.bundleIdentifier
        guard let identifier, identifier == bundleIdentifier + ".uitests.xctrunner" else {
            XCTFail("GET328 type evidence requires the exact UI runner identity; observed \(identifier ?? "missing")")
            return
        }
        let readCategory: @MainActor () -> (rawValue: String, isAccessibilityCategory: Bool, isUnspecified: Bool) = {
            let category = UIApplication.shared.preferredContentSizeCategory
            return (category.rawValue, category.isAccessibilityCategory, category == .unspecified)
        }
        let category: (rawValue: String, isAccessibilityCategory: Bool, isUnspecified: Bool)
        if Thread.isMainThread {
            category = MainActor.assumeIsolated { readCategory() }
        } else {
            // Only background setup uses sync; already-main setup samples
            // directly. No XCTestCase instance crosses actors.
            category = DispatchQueue.main.sync { MainActor.assumeIsolated { readCategory() } }
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let receipt: [String: Any] = ["schemaVersion": 1, "bundleIdentifier": identifier,
            "processIdentifier": ProcessInfo.processInfo.processIdentifier,
            "sampledAt": formatter.string(from: Date()), "category": category.rawValue,
            "isAccessibilityCategory": category.isAccessibilityCategory, "testCaseName": testCase.name]
        do {
            let data = try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys, .prettyPrinted])
            let attachment = XCTAttachment(string: String(decoding: data, as: UTF8.self))
            attachment.name = "GET328-runner-type-profile.json"
            attachment.lifetime = .keepAlways
            testCase.add(attachment)
        } catch { XCTFail("Could not retain GET328 runner type evidence: \(error)") }
        if category.isUnspecified { XCTFail("GET328 runner content-size category is unspecified") }
    }
}
