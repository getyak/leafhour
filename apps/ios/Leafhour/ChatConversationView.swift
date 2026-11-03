import SwiftUI
import LeafhourCore
import AVFoundation

/// One conversation surface serves both global Chat and an anchored selection.
struct ChatConversationView: View {
    @Bindable var tools: ReaderCloudTools
    let cloud: CloudLibraryClient?
    var title = "Chat"
    let bookTitle: String
    let source: String
    var sourceChapter = ""
    var canRemoveSource = false
    var sourceLabel = "引用的原文"
    var localOnly = false
    var isLibraryConversation = false
    var onSignIn: (() -> Void)? = nil
    let load: () async -> Void
    let send: () async -> Void
    @State private var didLoad = false
    @State private var sourceExpanded = false
    @State private var speech = ChatSpeechRecorder()
    @State private var sendingVoice = false
    @FocusState private var focused: Bool
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var canAsk: Bool {
        !localOnly && !tools.loading && !tools.generating && tools.retry == nil && tools.conversationAvailable && !tools.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 28) {
                    if isLibraryConversation && tools.turns.isEmpty { companionGreeting }
                    ForEach(tools.turns) { turn in
                        ChatTurnView(turn: turn, resolveVoice: { try await tools.voiceURL($0, cloud: cloud) }, playbackAllowed: !speech.isActive)
                    }
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
                .onChange(of: focused) { _, value in if value { scroll(proxy) } }
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
            .onChange(of: scenePhase) { _, phase in
                if phase != .active && speech.recording { Task { await captureVoice(sendAfter: false) } }
            }
            .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { notification in
                let kind = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
                if kind == AVAudioSession.InterruptionType.began.rawValue && speech.recording { Task { await captureVoice(sendAfter: false) } }
            }
            .onReceive(NotificationCenter.default.publisher(for: .AVAudioEngineConfigurationChange)) { _ in
                if speech.needsCaptureRecovery { Task { await captureVoice(sendAfter: false) } }
            }
            .onDisappear { if speech.isActive { tools.question = speech.cancel() } }
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
        HStack(alignment: .top, spacing: 6) {
            DisclosureGroup(isExpanded: $sourceExpanded) {
                ScrollView {
                    Text(source).font(.subheadline).lineSpacing(5).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
                }.frame(maxHeight: 140)
            } label: {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "text.quote").foregroundStyle(Color.leafInk).padding(.top, 2)
                    VStack(alignment: .leading, spacing: 4) {
                        if !sourceExpanded { Text(source).font(.subheadline).foregroundStyle(.primary).lineLimit(2) }
                        Text([bookTitle, sourceChapter].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                        Text(tools.chatQuoteRemoved ? "当前段落 · 未附加选文" : sourceLabel).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }.tint(Color.leafInk)
            if (canRemoveSource || tools.chatContext?.selection != nil) && !tools.chatQuoteRemoved {
            Button { tools.removeChatSelection(); sourceExpanded = false } label: {
                Image(systemName: "xmark").font(.caption).frame(width: 44, height: 44).contentShape(Rectangle())
            }.buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel("移除本次引用")
                .accessibilityIdentifier("chat-remove-source").disabled(tools.generating || tools.loading || tools.retry != nil)
            }
        }.padding(10).background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
            .accessibilityElement(children: .contain).accessibilityIdentifier("chat-source-context")
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
            if !source.isEmpty { context }
            if tools.canUpdateChatContext {
                Button("使用当前选文或原文", systemImage: "arrow.triangle.2.circlepath") { tools.updateChatContext(); sourceExpanded = false }
                    .font(.subheadline).frame(minHeight: 44)
            }
            if let voice = tools.pendingVoice {
                HStack(spacing: 8) {
                    Label("语音 · \(max(1, voice.durationMs / 1000)) 秒", systemImage: "waveform").font(.caption)
                    Spacer()
                    Button("移除语音", systemImage: "xmark.circle.fill") { tools.pendingVoice = nil }
                        .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 36).disabled(tools.generating || sendingVoice)
                }.foregroundStyle(.secondary).padding(.horizontal, 12)
            }
            HStack(alignment: .bottom, spacing: 8) {
                Button {
                    if speech.isActive { tools.question = speech.cancel() }
                    else { focused = false; Task { await speech.start(draft: tools.question) { tools.question = $0 } } }
                } label: {
                    Image(systemName: speech.isActive ? "xmark" : "mic.fill").font(.system(size: 17, weight: .medium))
                        .frame(width: 40, height: 44).foregroundStyle(speech.isActive ? Color.red : Color.secondary)
                }.buttonStyle(.plain).disabled(localOnly || tools.loading || tools.generating || tools.retry != nil || tools.pendingVoice != nil || sendingVoice)
                    .accessibilityLabel(speech.isActive ? "取消本次录音" : "语音输入").accessibilityIdentifier("chat-microphone")
                TextField(isLibraryConversation ? "和松鼠聊聊…" : "写下此刻的问题", text: $tools.question, axis: .vertical)
                    .lineLimit(1...6).focused($focused).padding(.vertical, 12)
                    .disabled(speech.isActive || sendingVoice)
                    .accessibilityAction(named: Text("收起键盘")) { focused = false }
                    .accessibilityIdentifier("reader-question").layoutPriority(1)
                Button { Task { if tools.generating { await tools.cancelConversation(cloud: cloud) } else if speech.recording { await captureVoice(sendAfter: true) } else { await send() } } } label: {
                    Group { if sendingVoice || speech.finishing { ProgressView() } else { Image(systemName: tools.generating ? "stop.fill" : "arrow.up").font(.body.weight(.semibold)) } }
                        .frame(width: 40, height: 40)
                        .foregroundStyle(canAsk || speech.recording || tools.generating ? Color(uiColor: .systemBackground) : Color.secondary)
                        .background(canAsk || speech.recording || tools.generating ? Color.primary : Color(uiColor: .tertiarySystemFill), in: Circle())
                }.buttonStyle(.plain).disabled((!canAsk && !speech.recording && !tools.generating) || speech.preparing || speech.finishing || sendingVoice)
                    .accessibilityLabel(tools.generating ? "停止回答" : speech.recording ? "发送语音和文字" : "发送消息").accessibilityIdentifier("reader-question-send")
            }.padding(.leading, 3).padding(.trailing, 6).padding(.vertical, 4)
                .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 26))
            if speech.isActive { Text(speech.preparing ? "正在打开麦克风…" : speech.finishing ? "正在整理语音…" : "正在录音 · 点麦克风取消，点箭头发送").font(.caption).foregroundStyle(.secondary).padding(.horizontal, 8) }
            if let error = speech.error { Text(error).font(.caption).foregroundStyle(.secondary).padding(.horizontal, 8) }
            if !focused && !isLibraryConversation {
                Text(localOnly ? "同步后可提问，输入的文字会保留。" : tools.scope == "library" ? "查阅自己的书房与网络 · 不读取私人笔记" : "围绕这本书 · 不读取私人笔记")
                    .font(.caption2).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .center)
            }
        }.frame(maxWidth: 680).padding(.horizontal, 16).padding(.vertical, 10).frame(maxWidth: .infinity)
            .background(Color(uiColor: .systemBackground))
            .background { GeometryReader { geometry in Color.clear.preference(key: CompanionComposerHeightKey.self, value: geometry.size.height) } }
    }
    private func captureVoice(sendAfter: Bool) async {
        guard !sendingVoice else { return }; sendingVoice = true; defer { sendingVoice = false }
        do {
            let recording = try await speech.finish()
            try await tools.attachVoice(recording)
            sendingVoice = false
            if sendAfter && !tools.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { await send() }
            else if sendAfter { speech.error = "录音已保留，可以补充文字后发送。" }
        } catch is CancellationError { }
        catch { speech.error = error.localizedDescription }
    }
}

private struct ChatTurnView: View {
    let turn: ReaderConversationTurn
    let resolveVoice: (ChatVoiceReceipt) async throws -> URL
    let playbackAllowed: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 6) {
                if let voice = turn.voice {
                    ChatVoiceMessageView(voice: voice, resolve: { try await resolveVoice(voice) }, playbackAllowed: playbackAllowed)
                    Text("转写文字").font(.caption2).foregroundStyle(.secondary)
                }
                if let quote = turn.quote { ChatSavedQuoteView(quote: quote) }
                Text(turn.question).font(.body).textSelection(.enabled)
            }.padding(16).background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
                .frame(maxWidth: .infinity, alignment: .trailing)
            VStack(alignment: .leading, spacing: 10) {
                Label("松鼠 · AI 陪读", systemImage: "leaf").font(.caption.weight(.medium)).foregroundStyle(Color.leafInk)
                if let answer = turn.answer { ChatMarkdownView(source: answer) }
                else { Label(turn.status == "running" ? "回答还在处理中" : "回答未完成，问题已保留", systemImage: turn.status == "running" ? "clock" : "exclamationmark.circle").font(.subheadline).foregroundStyle(.secondary) }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }.accessibilityIdentifier("reader-conversation-turn-" + turn.id)
    }
}

private struct ChatSavedQuoteView: View {
    let quote: ReaderTurnQuote
    @State private var expanded = false
    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            ForEach(Array(quote.parts.enumerated()), id: \.offset) { _, part in
                VStack(alignment: .leading, spacing: 4) {
                    Text(part.label).font(.caption2).foregroundStyle(.secondary)
                    Text(part.text).font(.subheadline).textSelection(.enabled)
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        } label: {
            Label(quote.parts.map(\.text).joined(separator: "\n"), systemImage: "text.quote")
                .font(.caption).foregroundStyle(.secondary).lineLimit(2)
        }.accessibilityIdentifier("chat-saved-quote")
    }
}
