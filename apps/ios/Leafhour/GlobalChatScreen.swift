import SwiftUI
import LeafhourCore

struct GlobalChatScreen: View {
    @Bindable var model: LibraryModel
    @State private var bookID: String?
    @State private var choosing = false
    @State private var query = ""
    @State private var login = false
    private var matchingBooks: [CloudShelfBook] { model.cloudBooks.filter { query.isEmpty || $0.title.localizedStandardContains(query) || $0.author.localizedStandardContains(query) } }
    private var book: CloudShelfBook? { model.cloudBooks.first { $0.id == bookID } }
    var body: some View {
        NavigationStack {
            Group {
                if let book, let owner = model.account?.id, case let tools = model.conversationTools(bookID: book.id) {
                    ChatConversationView(tools: tools, cloud: model.cloud, title: book.title, bookTitle: book.title,
                        source: tools.chatContext?.selection?.text ?? tools.chatContext?.original ?? "", sourceLabel: tools.chatContext.map { [$0.chapterTitle, $0.sourceLabel].filter { !$0.isEmpty }.joined(separator: " · ") } ?? "引用的原文",
                        load: {
                            await tools.restoreConversationDraft(identity: CloudBookIdentity(ownerID: owner, bookID: book.id, contentVersion: book.contentVersion, sourceFormat: ""), library: model.library)
                            await tools.loadConversation(book: book, ownerID: owner, cloud: model.cloud)
                        }, send: { await tools.prepareConversation(cloud: model.cloud) })
                        .id(book.id)
                } else {
                    let tools = model.conversationTools(bookID: ReaderCloudTools.libraryChatID)
                    ChatConversationView(tools: tools, cloud: model.cloud, title: "松鼠", bookTitle: "", source: "",
                        localOnly: model.account == nil, isLibraryConversation: true, onSignIn: { login = true },
                        load: {
                            guard let owner = model.account?.id else { return }
                            await tools.restoreConversationDraft(identity: ReaderCloudTools.libraryChatIdentity(ownerID: owner), library: model.library)
                            await tools.loadLibraryConversation(ownerID: owner, cloud: model.cloud)
                        }, send: {
                            guard let owner = model.account?.id else { login = true; return }
                            await tools.prepareLibraryConversation(ownerID: owner, cloud: model.cloud)
                        })
                }
            }.toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if book != nil {
                        Button("和松鼠聊聊", systemImage: "chevron.left") { bookID = nil }
                            .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44).accessibilityIdentifier("chat-return-companion")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { if model.account == nil { login = true } else { choosing = true } } label: {
                        Image(systemName: "books.vertical").frame(width: 44, height: 44).contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityLabel("选择对话的书").accessibilityIdentifier("chat-switch-book")
                }
            }
            .sheet(isPresented: $choosing) {
                NavigationStack {
                    List {
                        Button { bookID = nil; choosing = false } label: { Label("和松鼠聊聊", systemImage: "leaf") }.frame(minHeight: 44)
                        if model.syncing && model.cloudBooks.isEmpty { ProgressView("正在读取书房…") }
                        else if model.cloudBooks.isEmpty {
                            ContentUnavailableView("书房里还没有书", systemImage: "books.vertical", description: Text("可以直接和松鼠聊，之后再添加书籍。"))
                            if !model.syncStatus.isEmpty { Text(model.syncStatus).font(.footnote).foregroundStyle(.secondary) }
                            Button("重新读取书房") { Task { await model.synchronize() } }.frame(minHeight: 44)
                        }
                        if !model.cloudBooks.isEmpty && matchingBooks.isEmpty { ContentUnavailableView.search(text: query) }
                        ForEach(matchingBooks) { book in
                            Button {
                                bookID = book.id; choosing = false
                            } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "book.closed").foregroundStyle(Color.leafInk)
                                    VStack(alignment: .leading, spacing: 5) { Text(book.title).foregroundStyle(.primary); if !book.author.isEmpty { Text(book.author).font(.caption).foregroundStyle(.secondary) } }
                                    Spacer(minLength: 0)
                                    if bookID == book.id { Image(systemName: "checkmark").foregroundStyle(Color.leafInk) }
                                }.frame(minHeight: 48)
                            }
                        }
                    }.searchable(text: $query, prompt: "书名或作者").navigationTitle("选择对话的书")
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("完成") { choosing = false } } }
                }.presentationDetents([.large])
            }
            .sheet(isPresented: $login) { AccountScreen(model: model) }
        }.accessibilityIdentifier("global-chat-screen")
    }
}

struct LeafhourRootScreen: View {
    @Bindable var model: LibraryModel
    @Environment(\.colorScheme) private var systemColorScheme
    @State private var tab = 0
    var body: some View {
        TabView(selection: $tab) {
            LibraryScreen(model: model).tag(0).tabItem { Label("书房", systemImage: "books.vertical") }
            GlobalChatScreen(model: model).id(model.importAccountContext).tag(1).tabItem { Label("松鼠", systemImage: "leaf") }
            MyReadingScreen(model: model).id(model.importAccountContext).tag(2).tabItem { Label("我的阅读", systemImage: "book") }
        }.onOpenURL { url in tab = 0; model.receiveIncomingURL(url) }
            .fullScreenCover(item: $model.reader, onDismiss: { Task { await model.reload(); await model.synchronize() } }) { session in
                ReaderScreen(session: session, systemColorScheme: systemColorScheme, cloud: model.account == nil ? nil : model.cloud, library: model.library, positionConflict: model.syncIssues[session.book.id]?.positionConflict == true, resolvePosition: { useDevice in Task { await model.resolveActivePosition(useDevice: useDevice) } }, conversationTools: model.conversationTools(bookID: session.book.cloud?.bookID ?? session.book.id))
            }
    }
}
