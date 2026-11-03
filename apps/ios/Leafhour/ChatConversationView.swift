import SwiftUI
import LeafhourCore
import AVFoundation

private struct ChatBottomPositionKey: PreferenceKey {
    static var defaultValue: CGFloat = .greatestFiniteMagnitude
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

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
    @State private var followsResponse = true
    @State private var viewportHeight: CGFloat = 0
    @FocusState private var focused: Bool
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var canAsk: Bool {
        !localOnly && !tools.loading && !tools.generating && tools.retry == nil && tools.conversationAvailable && !tools.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 24) {
                    ForEach(tools.turns) { turn in
                        ChatTurnView(turn: turn,
                            responseText: turn.id == activeTurnID ? tools.responseText : "",
                            responding: turn.id == activeTurnID && turn.status == "running" && (tools.generating || tools.loading),
                            responseStatus: tools.responseStatus,
                            error: turn.id == failedTurnID ? tools.error : nil,
                            retry: tools.retry?.id == turn.id ? { retryRequest() } : nil,
                            resolveVoice: { try await tools.voiceURL($0, cloud: cloud) }, playbackAllowed: !speech.isActive)
                    }
                    status
                    Color.clear.frame(height: 1).id("chat-bottom")
                        .background { GeometryReader { geometry in
                            Color.clear.preference(key: ChatBottomPositionKey.self, value: geometry.frame(in: .named("conversation-scroll")).maxY)
                        } }
                }.frame(maxWidth: 680).padding(.horizontal, 20).padding(.vertical, 20).frame(maxWidth: .infinity)
            }.accessibilityIdentifier("reader-conversation-history")
                .coordinateSpace(name: "conversation-scroll")
                .background { GeometryReader { geometry in
                    Color.clear.onAppear { viewportHeight = geometry.size.height }
                        .onChange(of: geometry.size.height) { _, height in viewportHeight = height }
                } }
                .onPreferenceChange(ChatBottomPositionKey.self) { bottom in followsResponse = bottom <= viewportHeight + 44 }
                .defaultScrollAnchor(.bottom)
                .scrollDismissesKeyboard(.interactively)
                .safeAreaInset(edge: .bottom, spacing: 0) { composer }
                .onChange(of: tools.turns.last?.id) { _, _ in scroll(proxy) }
                .onChange(of: tools.turns.last?.status) { _, _ in scroll(proxy) }
                .onChange(of: tools.generating) { _, value in if value { scroll(proxy) } }
                .onChange(of: tools.responseText) { _, _ in
                    // Follow only from the bottom. Reading or selecting an earlier
                    // answer must not be interrupted by each incoming text delta.
                    if followsResponse { scroll(proxy, animated: false) }
                }
                .onChange(of: focused) { _, value in if value { scroll(proxy) } }
        }.background(Color(uiColor: .systemBackground))
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
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
    private var activeTurnID: String? { tools.retry?.id ?? tools.turns.last?.id }
    private var failedTurnID: String? {
        if let retry = tools.retry, tools.turns.contains(where: { $0.id == retry.id }) { return retry.id }
        guard let last = tools.turns.last, last.status != "completed" else { return nil }
        return last.id
    }
    private func retryRequest() {
        guard let retry = tools.retry else { return }
        Task { await tools.perform(retry, cloud: cloud) }
    }
    private func scroll(_ proxy: ScrollViewProxy, animated: Bool = true) {
        withAnimation(animated && !reduceMotion ? .easeOut(duration: 0.2) : nil) { proxy.scrollTo("chat-bottom", anchor: .bottom) }
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
                        Text(sourceLabel).font(.caption2).foregroundStyle(.secondary)
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
        if tools.generating && tools.turns.isEmpty { ProgressView(tools.responseStatus ?? "正在回答…").font(.caption).accessibilityIdentifier("chat-generating") }
        else if tools.turns.isEmpty && (tools.loading || !didLoad) { ProgressView("正在读取对话…").font(.caption) }
        else if tools.turns.isEmpty && tools.error == nil && !isLibraryConversation {
            Text(localOnly ? "登录后可以继续提问，输入的文字会保留。" : "想聊聊这段里的什么？")
                .font(.subheadline).foregroundStyle(.secondary).padding(.vertical, 12)
        }
        if isLibraryConversation && localOnly {
            Button("登录后继续聊", systemImage: "person.crop.circle") { onSignIn?() }.frame(minHeight: 44)
        } else if !localOnly && didLoad && !tools.loading && !tools.conversationAvailable && tools.error == nil {
            Button("重新连接") { Task { await reload() } }.font(.subheadline).frame(minHeight: 44)
        }
        if let error = tools.error, failedTurnID == nil, !tools.generating {
            VStack(alignment: .leading, spacing: 4) {
                Text(error).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                if tools.retry == nil { Button("重试") { Task { await reload() } }.font(.subheadline).frame(minHeight: 44).disabled(tools.loading) }
            }.accessibilityIdentifier("reader-conversation-error")
        }
        if tools.retry != nil && !tools.turns.contains(where: { $0.id == tools.retry?.id }) && !tools.generating {
            Button("重试", systemImage: "arrow.clockwise") { retryRequest() }
                .font(.subheadline).frame(minHeight: 44).disabled(tools.loading)
        }
        if let error = tools.draftError {
            Text(error).font(.footnote).foregroundStyle(.secondary)
            Button("重试保存与恢复草稿", systemImage: "arrow.clockwise") { Task { await tools.retryConversationDraftSave(); await reload() } }.frame(minHeight: 44)
        }
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !source.isEmpty && !tools.chatQuoteRemoved { context }
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
                    Group { if sendingVoice || speech.finishing { ProgressView() } else { Image(systemName: tools.generating ? "stop.fill" : "arrow.up").font(.system(size: tools.generating ? 14 : 17, weight: .semibold)) } }
                        .frame(width: 40, height: 40)
                        .foregroundStyle(canAsk || speech.recording || tools.generating ? Color(uiColor: .systemBackground) : Color.secondary)
                        .background(canAsk || speech.recording || tools.generating ? Color.primary : Color(uiColor: .tertiarySystemFill), in: Circle())
                }.buttonStyle(.plain).disabled((!canAsk && !speech.recording && !tools.generating) || speech.preparing || speech.finishing || sendingVoice)
                    .accessibilityLabel(tools.generating ? "停止回答" : speech.recording ? "发送语音和文字" : "发送消息").accessibilityIdentifier("reader-question-send")
            }.padding(.leading, 3).padding(.trailing, 6).padding(.vertical, 4)
                .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 26))
            if speech.isActive { Text(speech.preparing ? "正在打开麦克风…" : speech.finishing ? "正在整理语音…" : "正在录音 · 点麦克风取消，点箭头发送").font(.caption).foregroundStyle(.secondary).padding(.horizontal, 8) }
            if let error = speech.error { Text(error).font(.caption).foregroundStyle(.secondary).padding(.horizontal, 8) }
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
    var responseText = ""
    var responding = false
    var responseStatus: String?
    var error: String?
    var retry: (() -> Void)?
    let resolveVoice: (ChatVoiceReceipt) async throws -> URL
    let playbackAllowed: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 24) {
                Spacer(minLength: 24)
            VStack(alignment: .leading, spacing: 6) {
                if let voice = turn.voice {
                    ChatVoiceMessageView(voice: voice, resolve: { try await resolveVoice(voice) }, playbackAllowed: playbackAllowed)
                    Text("转写文字").font(.caption2).foregroundStyle(.secondary)
                }
                if let quote = turn.quote { ChatSavedQuoteView(quote: quote) }
                Text(turn.question).font(.body).textSelection(.enabled)
            }.padding(.horizontal, 14).padding(.vertical, 12)
                .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
            }
            VStack(alignment: .leading, spacing: 8) {
                if let answer = turn.answer, !answer.isEmpty { ChatMarkdownView(source: answer) }
                else if !responseText.isEmpty { ChatMarkdownView(source: responseText) }
                if responding {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.mini)
                        Text(responseStatus ?? (responseText.isEmpty ? "正在思考…" : "正在回答…"))
                    }.font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("chat-generating")
                } else if turn.status != "completed" {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(error ?? (turn.status == "cancelled" ? "已停止回答" : "回答未完成"))
                            .font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                        if let retry {
                            Button("重试", systemImage: "arrow.clockwise", action: retry)
                                .font(.subheadline).frame(minHeight: 44).accessibilityIdentifier("chat-turn-retry")
                        }
                    }.accessibilityIdentifier("reader-conversation-error")
                }
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
