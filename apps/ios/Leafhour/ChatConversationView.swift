import SwiftUI
import LeafhourCore

/// One conversation surface serves both global Chat and an anchored selection.
struct ChatConversationView: View {
    @Bindable var tools: ReaderCloudTools
    let cloud: CloudLibraryClient?
    var title = "Chat"
    let bookTitle: String
    let source: String
    var sourceLabel = "引用的原文"
    var localOnly = false
    var isLibraryConversation = false
    var onSignIn: (() -> Void)? = nil
    let load: () async -> Void
    let send: () async -> Void
    @State private var didLoad = false
    @State private var sourceExpanded = false
    @FocusState private var focused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var canAsk: Bool {
        !localOnly && !tools.loading && !tools.generating && tools.retry == nil && tools.conversationAvailable && !tools.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 28) {
                    if isLibraryConversation && tools.turns.isEmpty { companionGreeting }
                    if !source.isEmpty { context }
                    if tools.canUpdateChatContext {
                        Button("改用当前原文", systemImage: "arrow.triangle.2.circlepath") { tools.updateChatContext() }
                            .font(.subheadline).frame(minHeight: 44)
                    }
                    ForEach(tools.turns) { turn in ChatTurnView(turn: turn) }
                    status
                    Color.clear.frame(height: 1).id("chat-bottom")
                }.frame(maxWidth: 680).padding(.horizontal, 20).padding(.vertical, 20).frame(maxWidth: .infinity)
            }.accessibilityIdentifier("reader-conversation-history")
                .defaultScrollAnchor(.bottom)
                .scrollDismissesKeyboard(.interactively)
                .safeAreaInset(edge: .bottom, spacing: 0) { composer }
                .onChange(of: tools.turns.last?.id) { _, _ in scroll(proxy) }
                .onChange(of: tools.turns.last?.status) { _, _ in scroll(proxy) }
                .onChange(of: tools.generating) { _, value in if value { scroll(proxy) } }
        }.background(Color(uiColor: .systemBackground))
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("刷新对话", systemImage: "arrow.clockwise") { Task { await reload() } }
                        .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                        .disabled(tools.loading || tools.generating || tools.retry != nil)
                }
            }
            .task { await reload() }
            .modifier(ReaderGenerationConfirmation(tools: tools, cloud: cloud))
    }
    private func reload() async { await load(); if !Task.isCancelled { didLoad = true } }
    private func scroll(_ proxy: ScrollViewProxy) {
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { proxy.scrollTo("chat-bottom", anchor: .bottom) }
    }
    private var companionGreeting: some View {
        VStack(alignment: .leading, spacing: 14) {
            Image(systemName: "leaf.fill").font(.system(size: 26, weight: .light)).foregroundStyle(Color.leafInk)
                .frame(width: 62, height: 62).background(Color.leafInk.opacity(0.07), in: Circle()).accessibilityHidden(true)
            Text("我在，想聊点什么？").font(.title2.weight(.medium))
            Text("一本书，一个想法，或今天的心情。").font(.subheadline).foregroundStyle(.secondary)
        }.padding(.top, 28).padding(.bottom, 12).accessibilityIdentifier("chat-companion-greeting")
    }
    private var context: some View {
        DisclosureGroup(isExpanded: $sourceExpanded) {
            Text(source).font(.subheadline).lineSpacing(5).textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "text.quote").foregroundStyle(Color.leafInk).padding(.top, 2)
                VStack(alignment: .leading, spacing: 5) {
                    Text(bookTitle).font(.subheadline.weight(.medium)).foregroundStyle(.primary).lineLimit(2)
                    if !sourceExpanded { Text(source).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                    Text(sourceLabel).font(.caption2).foregroundStyle(.secondary)
                }
            }
        }.tint(Color.leafInk).padding(14)
            .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
            .accessibilityIdentifier("chat-source-context")
    }
    @ViewBuilder private var status: some View {
        if tools.generating { ProgressView("正在回答…").accessibilityIdentifier("chat-generating") }
        else if tools.loading || !didLoad { ProgressView("正在读取对话…") }
        else if tools.turns.isEmpty && tools.error == nil && !isLibraryConversation {
            VStack(alignment: .leading, spacing: 14) {
                Image(systemName: "bubble.left.and.bubble.right").font(.largeTitle.weight(.ultraLight)).foregroundStyle(Color.leafInk).accessibilityHidden(true)
                Text(localOnly ? "把问题留在这里" : "从一个问题开始").font(.title2.weight(.medium))
                Text(localOnly ? "登录并同步这本书后，就能围绕原文继续聊。" : tools.conversationAvailable ? "聊聊难懂的句子，也可以把书里的想法再往前想一步。" : "陪读服务暂不可用。可以保留问题，稍后刷新重试。")
                    .font(.subheadline).foregroundStyle(.secondary)
                if !localOnly && tools.conversationAvailable {
                    ForEach(["解释这段的意思", "这里的论证是怎样展开的？", "举一个更容易理解的例子"], id: \.self) { prompt in
                        Button { tools.question = prompt; focused = true } label: {
                            HStack { Text(prompt).multilineTextAlignment(.leading); Spacer(minLength: 8); Image(systemName: "arrow.up.left").font(.caption) }
                                .padding(.horizontal, 14).frame(minHeight: 48).contentShape(RoundedRectangle(cornerRadius: 14))
                        }.buttonStyle(.plain).font(.subheadline)
                            .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
                    }
                }
            }.padding(.vertical, 28)
        }
        if isLibraryConversation && localOnly {
            Button("登录后继续聊", systemImage: "person.crop.circle") { onSignIn?() }.frame(minHeight: 44)
        } else if isLibraryConversation && didLoad && !tools.loading && !tools.conversationAvailable && tools.error == nil {
            Text("陪读暂时无法连接，问题会保留。稍后可刷新重试。").font(.subheadline).foregroundStyle(.secondary)
        }
        if let error = tools.error {
            VStack(alignment: .leading, spacing: 8) {
                Label("暂时无法完成", systemImage: "exclamationmark.circle").font(.subheadline.weight(.medium))
                Text(error).font(.subheadline).foregroundStyle(.secondary).textSelection(.enabled)
                if tools.retry == nil { Button("重新读取对话") { Task { await reload() } }.frame(minHeight: 44).disabled(tools.loading || tools.generating) }
            }.accessibilityIdentifier("reader-conversation-error")
        }
        if let retry = tools.retry {
            Button("重试查看本次结果", systemImage: "arrow.clockwise") { Task { await tools.perform(retry, cloud: cloud) } }
                .frame(minHeight: 44).disabled(tools.generating || tools.loading)
        }
        if let error = tools.draftError {
            Text(error).font(.footnote).foregroundStyle(.secondary)
            Button("重试保存与恢复草稿", systemImage: "arrow.clockwise") { Task { await tools.retryConversationDraftSave(); await reload() } }.frame(minHeight: 44)
        }
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .bottom, spacing: 8) {
                TextField(isLibraryConversation ? "和松鼠聊聊…" : "写下此刻的问题", text: $tools.question, axis: .vertical)
                    .lineLimit(1...5).focused($focused).padding(.horizontal, 16).padding(.vertical, 12)
                    .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 22))
                    .accessibilityIdentifier("reader-question").layoutPriority(1)
                if focused {
                    Button("收起键盘", systemImage: "keyboard.chevron.compact.down") { focused = false }
                        .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                        .accessibilityIdentifier("reader-question-dismiss-keyboard")
                }
                Button { focused = false; Task { await send() } } label: {
                    Image(systemName: "arrow.up").font(.body.weight(.semibold)).frame(width: 46, height: 46)
                        .foregroundStyle(canAsk ? Color(uiColor: .systemBackground) : Color.secondary)
                        .background(canAsk ? Color.primary : Color(uiColor: .tertiarySystemFill), in: Circle())
                }.buttonStyle(.plain).disabled(!canAsk).accessibilityLabel("向陪读提问").accessibilityIdentifier("reader-question-send")
            }
            if !focused && !isLibraryConversation {
                Text(localOnly ? "同步后可提问，输入的文字会保留。" : tools.scope == "library" ? "查阅自己的书房与网络 · 不读取私人笔记" : "围绕这本书 · 不读取私人笔记")
                    .font(.caption2).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .center)
            }
        }.frame(maxWidth: 680).padding(.horizontal, 16).padding(.vertical, 10).frame(maxWidth: .infinity)
            .background(Color(uiColor: .systemBackground))
            .background { GeometryReader { geometry in Color.clear.preference(key: CompanionComposerHeightKey.self, value: geometry.size.height) } }
    }
}

private struct ChatTurnView: View {
    let turn: ReaderConversationTurn
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 6) {
                Text(turn.question).font(.body).textSelection(.enabled)
            }.padding(16).background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
                .frame(maxWidth: .infinity, alignment: .trailing)
            VStack(alignment: .leading, spacing: 10) {
                Label("松鼠 · AI 陪读", systemImage: "leaf").font(.caption.weight(.medium)).foregroundStyle(Color.leafInk)
                if let answer = turn.answer { Text(.init(answer)).font(.body).lineSpacing(6).textSelection(.enabled) }
                else { Label(turn.status == "running" ? "回答还在处理中" : "回答未完成，问题已保留", systemImage: turn.status == "running" ? "clock" : "exclamationmark.circle").font(.subheadline).foregroundStyle(.secondary) }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }.accessibilityIdentifier("reader-conversation-turn-" + turn.id)
    }
}
