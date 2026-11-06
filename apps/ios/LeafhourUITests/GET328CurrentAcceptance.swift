import XCTest

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
}
