import AuthenticationServices
import SwiftUI
import LeafhourCore

@MainActor protocol NativeAuthenticationSession: AnyObject {
    func start() -> Bool
    func cancel()
}
extension ASWebAuthenticationSession: NativeAuthenticationSession { }

/// Only the system authentication browser sees provider pages. No provider token enters a deep link.
@MainActor final class NativeProviderAuthentication: NSObject, ASWebAuthenticationPresentationContextProviding {
    typealias Factory = (URL, @escaping (URL?, Error?) -> Void) -> any NativeAuthenticationSession
    private let factory: Factory?
    private weak var anchor: UIWindow?
    private var session: (any NativeAuthenticationSession)?
    private var continuation: CheckedContinuation<URL, Error>?
    private var operation: UUID?
    private var expiry: Date?
    private var expiryTask: Task<Void, Never>?
    var isActive: Bool { operation != nil }
    init(factory: Factory? = nil) { self.factory = factory }
    func setAnchor(_ window: UIWindow?) { anchor = window }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor ?? ASPresentationAnchor() }
    func authenticate(_ flow: NativeOAuthFlow) async throws -> URL {
        guard operation == nil, anchor != nil, flow.expiresAt > Date() else { throw LibraryError.invalid("请回到账号页后重新打开登录窗口。") }
        let marker = UUID(); operation = marker; expiry = flow.expiresAt
        expiryTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(max(0, flow.expiresAt.timeIntervalSinceNow))) }
            catch { return }
            guard let self, self.operation == marker else { return }
            self.checkExpiry()
        }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                let completion: (URL?, Error?) -> Void = { [weak self] url, error in
                    Task { @MainActor [weak self] in self?.finish(marker, url: url, error: error) }
                }
                let browser: any NativeAuthenticationSession
                if let factory { browser = factory(flow.url, completion) }
                else {
                    let value: ASWebAuthenticationSession
                    if #available(iOS 17.4, *) { value = ASWebAuthenticationSession(url: flow.url, callback: .customScheme(NativeOAuthPolicy.callbackScheme), completionHandler: completion) }
                    else { value = ASWebAuthenticationSession(url: flow.url, callbackURLScheme: NativeOAuthPolicy.callbackScheme, completionHandler: completion) }
                    value.presentationContextProvider = self; value.prefersEphemeralWebBrowserSession = true
                    browser = value
                }
                session = browser
                if !browser.start() { finish(marker, url: nil, error: LibraryError.invalid("暂时无法打开系统登录窗口，请稍后重试。")) }
            }
        } onCancel: { Task { @MainActor [weak self] in self?.cancel() } }
    }
    func cancel() { terminate(CancellationError()) }
    private func terminate(_ error: Error) {
        let pending = continuation, browser = session
        operation = nil; continuation = nil; session = nil; expiry = nil; expiryTask?.cancel(); expiryTask = nil
        browser?.cancel(); pending?.resume(throwing: error)
    }
    func checkExpiry(now: Date = Date()) { if let expiry, expiry <= now { terminate(LibraryError.invalid("这次登录已过期，请重新开始。")) } }
    private func finish(_ marker: UUID, url: URL?, error: Error?) {
        guard operation == marker, let pending = continuation else { return }
        let expired = (expiry ?? .distantPast) <= Date()
        operation = nil; continuation = nil; session = nil; expiry = nil; expiryTask?.cancel(); expiryTask = nil
        if expired { pending.resume(throwing: LibraryError.invalid("这次登录已过期，请重新开始。")) }
        else if let error {
            if (error as NSError).domain == ASWebAuthenticationSessionErrorDomain && (error as NSError).code == ASWebAuthenticationSessionError.canceledLogin.rawValue { pending.resume(throwing: CancellationError()) }
            else { pending.resume(throwing: LibraryError.invalid("系统登录暂时无法完成，请稍后重试。")) }
        } else if let url { pending.resume(returning: url) }
        else { pending.resume(throwing: LibraryError.invalid("登录回程无法安全核对，请重新开始。")) }
    }
}

struct NativeAuthenticationAnchor: UIViewRepresentable {
    let onWindow: (UIWindow?) -> Void
    func makeUIView(context: Context) -> AnchorView { let view = AnchorView(); view.onWindow = onWindow; return view }
    func updateUIView(_ view: AnchorView, context: Context) { view.onWindow = onWindow; onWindow(view.window) }
    final class AnchorView: UIView {
        var onWindow: ((UIWindow?) -> Void)?
        override func didMoveToWindow() { super.didMoveToWindow(); onWindow?(window) }
    }
}

struct NativeAppleAuthenticationButton: UIViewRepresentable {
    let enabled: Bool
    let action: () -> Void
    @Environment(\.colorScheme) private var colorScheme
    func makeCoordinator() -> Coordinator { Coordinator(action) }
    func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
        let view = ASAuthorizationAppleIDButton(type: .continue, style: colorScheme == .dark ? .white : .black)
        view.cornerRadius = 10; view.addTarget(context.coordinator, action: #selector(Coordinator.activate), for: .touchUpInside)
        view.accessibilityIdentifier = "leafhour-login-apple"; return view
    }
    func updateUIView(_ view: ASAuthorizationAppleIDButton, context: Context) { context.coordinator.action = action; view.isEnabled = enabled; view.alpha = enabled ? 1 : 0.45 }
    final class Coordinator: NSObject {
        var action: () -> Void
        init(_ action: @escaping () -> Void) { self.action = action }
        @objc func activate() { action() }
    }
}
