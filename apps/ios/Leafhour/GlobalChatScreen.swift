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
                    ChatConversationView(tools: tools, cloud: model.cloud, bookTitle: book.title,
                        source: tools.chatContext?.selection?.text ?? tools.chatContext?.original ?? "", sourceLabel: tools.chatContext.map { [$0.chapterTitle, $0.sourceLabel].filter { !$0.isEmpty }.joined(separator: " · ") } ?? "引用的原文",
                        load: {
                            await tools.restoreConversationDraft(identity: CloudBookIdentity(ownerID: owner, bookID: book.id, contentVersion: book.contentVersion, sourceFormat: ""), library: model.library)
                            await tools.loadConversation(book: book, ownerID: owner, cloud: model.cloud)
                        }, send: { await tools.prepareConversation(cloud: model.cloud) })
                        .id(book.id)
                } else {
                    VStack(spacing: 20) {
                        Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 44, weight: .ultraLight)).foregroundStyle(Color.leafInk).accessibilityHidden(true)
                        Text("和一本书聊聊").font(.title2.weight(.medium))
                        Text(model.account == nil ? "登录自己的书房，把阅读中的问题和对话留在一起。" : "选一本书，继续已有对话，或从新的问题开始。")
                            .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        Button(model.account == nil ? "登录书房" : "选择一本书") { if model.account == nil { login = true } else { choosing = true } }
                            .buttonStyle(.borderedProminent).controlSize(.large)
                            .accessibilityIdentifier("chat-choose-book")
                    }.padding(32).frame(maxWidth: .infinity, maxHeight: .infinity)
                        .navigationTitle("Chat")
                }
            }.toolbar {
                if book != nil {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("切换书籍", systemImage: "books.vertical") { choosing = true }.labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                            .accessibilityIdentifier("chat-switch-book")
                    }
                }
            }
            .sheet(isPresented: $choosing) {
                NavigationStack {
                    List {
                        if model.syncing && model.cloudBooks.isEmpty { ProgressView("正在读取书房…") }
                        else if model.cloudBooks.isEmpty {
                            ContentUnavailableView("书房里还没有书", systemImage: "books.vertical", description: Text("先在书房导入并同步一本书，再来继续聊。"))
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
    @State private var tab = 0
    var body: some View {
        TabView(selection: $tab) {
            LibraryScreen(model: model).tag(0).tabItem { Label("书房", systemImage: "books.vertical") }
            GlobalChatScreen(model: model).id(model.importAccountContext).tag(1).tabItem { Label("Chat", systemImage: "bubble.left.and.bubble.right") }
            AppSettingsScreen(model: model).id(model.importAccountContext).tag(2).tabItem { Label("设置", systemImage: "slider.horizontal.3") }
        }.onOpenURL { url in tab = 0; model.receiveIncomingURL(url) }
    }
}
