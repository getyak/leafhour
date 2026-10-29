import SwiftUI
import WebKit
import Observation
import LeafhourCore

enum ReaderWebNavigation: Equatable { case embedded, external, blocked }
enum ReaderWebPolicy {
    static func sameOrigin(_ url: URL, _ origin: URL) -> Bool {
        guard url.user == nil, url.password == nil, origin.user == nil, origin.password == nil,
              url.scheme?.lowercased() == "https", origin.scheme?.lowercased() == "https",
              let host = url.host?.lowercased(), host == origin.host?.lowercased() else { return false }
        return (url.port ?? 443) == (origin.port ?? 443)
    }
    static func credentialMatches(_ credential: CloudCredential?, identity: CloudBookIdentity) -> Bool {
        guard let credential else { return false }
        let safeToken = !credential.token.isEmpty && credential.token.utf8.allSatisfy { byte in
            (65...90).contains(byte) || (97...122).contains(byte) || (48...57).contains(byte) || [45, 46, 95, 126].contains(byte)
        }
        return credential.account.id == identity.ownerID && safeToken
    }
    static func initialURL(origin: URL, bookID: String, passageID: String?) -> URL? {
        guard sameOrigin(origin, origin), !bookID.isEmpty, var components = URLComponents(url: origin, resolvingAgainstBaseURL: false) else { return nil }
        components.path = "/read"; components.fragment = nil
        components.queryItems = [URLQueryItem(name: "book", value: bookID)] + (passageID.map { [URLQueryItem(name: "passage", value: $0)] } ?? [])
        return components.url
    }
    static func navigation(_ url: URL?, origin: URL, userActivated: Bool, mainFrame: Bool) -> ReaderWebNavigation {
        guard let url else { return .blocked }
        if sameOrigin(url, origin) { return .embedded }
        if mainFrame, userActivated, ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.user == nil, url.password == nil { return .external }
        return .blocked
    }
}

/// The web's extra tools use an isolated, short-lived cookie jar, never Safari's session.
@MainActor @Observable
final class ReaderWebToolsModel: NSObject, WKNavigationDelegate, WKUIDelegate, WKHTTPCookieStoreObserver {
    private(set) var webView: WKWebView?
    private(set) var loading = false
    private(set) var message: String?
    @ObservationIgnored private var cloud: CloudLibraryClient?
    @ObservationIgnored private var identity: CloudBookIdentity?
    @ObservationIgnored private var origin: URL?
    @ObservationIgnored private var token: String?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var store: WKWebsiteDataStore?

    func open(_ session: ReaderSession, cloud: CloudLibraryClient?) async {
        close(); message = nil
        guard let cloud, let identity = session.book.cloud else { message = "请先在书房登录，并同步这本书后再打开更多工具。"; return }
        let marker = UUID(); generation = marker; loading = true
        do {
            let origin = await cloud.baseURL
            guard let credential = await cloud.savedCredential(), ReaderWebPolicy.credentialMatches(credential, identity: identity),
                  let url = ReaderWebPolicy.initialURL(origin: origin, bookID: identity.bookID, passageID: ReaderCloudTools.currentPassage(session)?.id) else {
                throw LibraryError.invalid("请重新进入自己的书房后再打开工具。")
            }
            let bytes = try await cloud.data(path: "/api/auth/session", ownerID: identity.ownerID)
            let current = try CloudJSON.decode(bytes)
            guard current["user"]["id"].string == identity.ownerID else { throw LibraryError.invalid("书房账号已变化，请重新登录。") }
            try Task.checkCancellation(); guard generation == marker else { return }
            let dataStore = WKWebsiteDataStore.nonPersistent()
            let configuration = WKWebViewConfiguration(); configuration.websiteDataStore = dataStore
            configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
            guard let cookie = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": "marginalia_session=\(credential.token); Path=/; Secure; HttpOnly; SameSite=Strict"], for: origin).first,
                  cookie.isSecure, cookie.isHTTPOnly, cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased() == origin.host?.lowercased() else {
                throw LibraryError.invalid("暂时无法安全连接网页版工具。")
            }
            await withCheckedContinuation { continuation in dataStore.httpCookieStore.setCookie(cookie) { continuation.resume() } }
            try Task.checkCancellation(); guard generation == marker else { return }
            guard await cloud.activeAccount()?.id == identity.ownerID else { throw LibraryError.invalid("书房账号已变化，请重新打开工具。") }
            self.cloud = cloud; self.identity = identity; self.origin = origin; token = credential.token; store = dataStore
            let view = WKWebView(frame: .zero, configuration: configuration)
            view.navigationDelegate = self; view.uiDelegate = self; view.allowsBackForwardNavigationGestures = true
            view.isOpaque = false; view.accessibilityIdentifier = "reader-extra-web-tools"
            dataStore.httpCookieStore.add(self)
            webView = view; view.load(URLRequest(url: url))
        } catch is CancellationError { if generation == marker { close() } }
        catch { if generation == marker { loading = false; message = error.localizedDescription } }
    }
    func close() {
        generation = UUID(); loading = false
        webView?.stopLoading(); webView?.navigationDelegate = nil; webView?.uiDelegate = nil
        if let store {
            store.httpCookieStore.remove(self)
            store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) { }
        }
        webView = nil; store = nil; token = nil; cloud = nil; identity = nil; origin = nil
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard self.webView === webView, let origin, let identity, let cloud,
              await cloud.activeAccount()?.id == identity.ownerID else { close(); message = "书房账号已变化，请重新打开工具。"; return .cancel }
        let decision = ReaderWebPolicy.navigation(navigationAction.request.url, origin: origin, userActivated: navigationAction.navigationType == .linkActivated, mainFrame: navigationAction.targetFrame?.isMainFrame ?? true)
        switch decision {
        case .embedded: return .allow
        case .external:
            if let url = navigationAction.request.url { await UIApplication.shared.open(url) }
            return .cancel
        case .blocked: return .cancel
        }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard navigationAction.targetFrame == nil, let origin else { return nil }
        switch ReaderWebPolicy.navigation(navigationAction.request.url, origin: origin, userActivated: navigationAction.navigationType == .linkActivated, mainFrame: true) {
        case .embedded: webView.load(navigationAction.request)
        case .external: if let url = navigationAction.request.url { UIApplication.shared.open(url) }
        case .blocked: break
        }
        return nil
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        guard self.webView === webView, let origin, let url = navigationResponse.response.url,
              ReaderWebPolicy.sameOrigin(url, origin), navigationResponse.canShowMIMEType,
              let identity, let cloud, await cloud.activeAccount()?.id == identity.ownerID else { return .cancel }
        return .allow
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loading = false }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { loading = false; message = "网页版工具暂时无法载入，可以继续使用原生阅读工具。" }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { loading = false; message = "网页版工具暂时无法载入，可以继续使用原生阅读工具。" }
    }
    func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
        let marker = generation
        cookieStore.getAllCookies { [weak self] cookies in
            Task { @MainActor [weak self] in
                guard let self, self.generation == marker, let token = self.token else { return }
                guard cookies.contains(where: { $0.name == "marginalia_session" && $0.value == token }) else {
                    self.close(); self.message = "网页版的登录已变化。请回书房核对账号后重新打开。"; return
                }
            }
        }
    }
}

struct ReaderWebToolsPanel: View {
    let session: ReaderSession
    let cloud: CloudLibraryClient?
    @State private var model = ReaderWebToolsModel()
    var body: some View {
        Group {
            if let view = model.webView {
                ReaderEphemeralWebView(view: view)
                    .overlay(alignment: .top) { if model.loading { ProgressView().padding(10).background(.regularMaterial, in: Capsule()) } }
            } else if let message = model.message {
                ContentUnavailableView("暂时无法打开更多工具", systemImage: "network", description: Text(message))
            } else { ProgressView("正在连接自己的书房…") }
        }.navigationTitle("更多书房工具 · 网页版")
            .navigationBarTitleDisplayMode(.inline)
            .task { await model.open(session, cloud: cloud) }
            .onDisappear { model.close() }
    }
}
private struct ReaderEphemeralWebView: UIViewRepresentable {
    let view: WKWebView
    func makeUIView(context: Context) -> WKWebView { view }
    func updateUIView(_ uiView: WKWebView, context: Context) { }
}
