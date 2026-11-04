import SwiftUI
import LeafhourCore
import AVFoundation
import Observation

/// User input owns intent; the bottom marker owns position.
struct ChatScrollLayout: Equatable {
    let container: CGSize
    let insets: EdgeInsets
}

@MainActor @Observable final class ChatScrollState {
    private(set) var followsLatest = true
    private(set) var isAtLatest = false
    @ObservationIgnored private var userScrolling = false
    @ObservationIgnored private var followedAtStart = true
    @ObservationIgnored private var layoutAtStart: ChatScrollLayout?
    @ObservationIgnored private var legacyGestureActive = false
    @ObservationIgnored private var legacyWaitingForIdle = false
    @ObservationIgnored private var legacyLayout: ChatScrollLayout?
    @ObservationIgnored private var legacySettlement: Task<Void, Never>?

    func updateBottomVisibility(_ visible: Bool) { isAtLatest = visible }
    func beginBrowsing(layout: ChatScrollLayout? = nil) {
        cancelLegacySettlement(); legacyGestureActive = false
        startBrowsing(layout: layout)
    }
    private func startBrowsing(layout: ChatScrollLayout?) {
        followedAtStart = followsLatest; layoutAtStart = layout
        userScrolling = true; followsLatest = false
    }
    func endBrowsing(layout: ChatScrollLayout? = nil) {
        guard userScrolling else { return }
        userScrolling = false
        let resized = layoutAtStart != layout
        if isAtLatest && (!resized || followedAtStart) { resumeFollowing() }
        layoutAtStart = nil
    }
    func resumeFollowing() {
        cancelLegacySettlement(); legacyGestureActive = false
        followsLatest = true; userScrolling = false; layoutAtStart = nil
    }
    func beginLegacyBrowsing(layout: ChatScrollLayout? = nil) {
        cancelLegacySettlement()
        if !legacyGestureActive { legacyGestureActive = true; startBrowsing(layout: layout) }
    }
    func endLegacyBrowsing(layout: ChatScrollLayout? = nil) {
        guard userScrolling else { return }
        legacyGestureActive = false; legacyWaitingForIdle = true; legacyLayout = layout
        settleLegacyScroll()
    }
    func updateLegacyBottomVisibility(_ visible: Bool, layout: ChatScrollLayout? = nil) {
        updateBottomVisibility(visible); legacyLayout = layout
        if legacyWaitingForIdle { settleLegacyScroll() }
    }
    func cancelLegacyBrowsing() {
        cancelLegacySettlement(); legacyGestureActive = false; userScrolling = false; layoutAtStart = nil
    }
    private func cancelLegacySettlement() {
        legacySettlement?.cancel(); legacySettlement = nil; legacyWaitingForIdle = false
    }
    private func settleLegacyScroll() {
        legacySettlement?.cancel()
        legacySettlement = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: .milliseconds(120)) } catch { return }
            guard let self, !Task.isCancelled else { return }
            let layout = self.legacyLayout
            self.legacyWaitingForIdle = false; self.legacySettlement = nil
            self.endBrowsing(layout: layout)
        }
    }
}

private struct ChatBottomFrameKey: PreferenceKey {
    static var defaultValue: CGRect = .null
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) { value = nextValue() }
}

private struct ChatBottomMarker: ViewModifier {
    let position: ChatScrollState
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 18, *) {
            content.onScrollVisibilityChange(threshold: 0.5) { position.updateBottomVisibility($0) }
                .onDisappear { position.updateBottomVisibility(false) }
        } else {
            content.background { GeometryReader { geometry in
                Color.clear.preference(key: ChatBottomFrameKey.self, value: geometry.frame(in: .named("conversation-scroll")))
            } }
        }
    }
}

private struct ChatScrollTracking: ViewModifier {
    let position: ChatScrollState
    @State private var fallbackLayout = ChatScrollLayout(container: .zero, insets: EdgeInsets())
    @State private var fallbackBottom: CGRect = .null
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 18, *) {
            content.onScrollPhaseChange { _, phase, context in
                let layout = ChatScrollLayout(container: context.geometry.containerSize, insets: context.geometry.contentInsets)
                switch phase {
                case .interacting: position.beginBrowsing(layout: layout)
                case .idle: position.endBrowsing(layout: layout)
                default: break
                }
            }
        } else {
            content.background { GeometryReader { geometry in
                Color.clear.onAppear { fallbackLayout = ChatScrollLayout(container: geometry.size, insets: geometry.safeAreaInsets) }
                    .onChange(of: ChatScrollLayout(container: geometry.size, insets: geometry.safeAreaInsets)) { _, layout in fallbackLayout = layout }
            } }
            .onPreferenceChange(ChatBottomFrameKey.self) { frame in
                fallbackBottom = frame; updateLegacyPosition(frame, layout: fallbackLayout)
            }
            .onChange(of: fallbackLayout) { _, layout in updateLegacyPosition(fallbackBottom, layout: layout) }
            .simultaneousGesture(DragGesture(minimumDistance: 12)
                .onChanged { _ in position.beginLegacyBrowsing(layout: fallbackLayout) }
                .onEnded { _ in position.endLegacyBrowsing(layout: fallbackLayout) })
            .onDisappear { position.cancelLegacyBrowsing() }
        }
    }
    private func updateLegacyPosition(_ frame: CGRect, layout: ChatScrollLayout) {
        guard !frame.isNull, layout.container.height > 0 else { return }
        let visibleBottom = layout.container.height - max(0, layout.insets.bottom)
        position.updateLegacyBottomVisibility(frame.maxY <= visibleBottom + 44, layout: layout)
    }
}

private struct ChatScrollAnchoring: ViewModifier {
    let followsLatest: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 18, *) {
            content.defaultScrollAnchor(.bottom, for: .initialOffset)
                .defaultScrollAnchor(.bottom, for: .alignment)
                .defaultScrollAnchor(followsLatest ? .bottom : .top, for: .sizeChanges)
        } else {
            content.defaultScrollAnchor(followsLatest ? .bottom : .top)
        }
    }
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
    @State private var composerAwake = true
    @State private var didLoad = false
    @State private var sourceExpanded = false
    @State private var referenceExpanded = false
    @State private var speech = ChatSpeechRecorder()
    @State private var sendingVoice = false
    @State private var scrollPosition = ChatScrollState()
    @State private var latestRequest = UUID()
    @FocusState private var focused: Bool
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    private var shortHeight: Bool { verticalSizeClass == .compact }
    private var composerLines: ClosedRange<Int> {
        guard shortHeight else { return 1...6 }
        return 1...(focused ? 1 : (sourceExpanded || referenceExpanded ? 2 : 3))
    }
    private var canAsk: Bool {
        !localOnly && !tools.loading && !tools.generating && tools.retry == nil && tools.conversationAvailable && !tools.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 24) {
                    ForEach(tools.turns.dropLast(2)) { turn in conversationTurn(turn) }
                    // Keep the previous exchange and the live exchange together.
                    // The streaming row must be measured before scrolling to it;
                    // older, completed exchanges can remain lazily rendered.
                    VStack(alignment: .leading, spacing: 24) {
                        ForEach(tools.turns.suffix(2)) { turn in conversationTurn(turn) }
                        status
                        Color.clear.frame(height: 1).modifier(ChatBottomMarker(position: scrollPosition))
                    }.id("chat-bottom")
                }.frame(maxWidth: 680).padding(.horizontal, 20).padding(.vertical, 20).frame(maxWidth: .infinity)
            }.accessibilityIdentifier("reader-conversation-history")
                .coordinateSpace(name: "conversation-scroll")
                .modifier(ChatScrollTracking(position: scrollPosition))
                .modifier(ChatScrollAnchoring(followsLatest: scrollPosition.followsLatest))
                .simultaneousGesture(DragGesture(minimumDistance: 12).onChanged { _ in
                    if !focused { composerAwake = false }
                })
                .scrollDismissesKeyboard(.interactively)
                .safeAreaInset(edge: .bottom, spacing: 0) { composer }
                .onChange(of: latestRequest) { _, _ in scroll(proxy) }
                .onChange(of: tools.turns.last?.id) { _, _ in if scrollPosition.followsLatest { scroll(proxy) } }
                .onChange(of: tools.turns.last?.status) { _, _ in if scrollPosition.followsLatest { scroll(proxy) } }
                .onChange(of: tools.generating) { _, value in if value && scrollPosition.followsLatest { scroll(proxy) } }
                .onChange(of: tools.responseText) { _, _ in
                    // Follow only from the bottom. Reading or selecting an earlier
                    // answer must not be interrupted by each incoming text delta.
                    if scrollPosition.followsLatest { scroll(proxy, animated: false) }
                }
                .onChange(of: focused) { _, value in
                    if value && shortHeight { sourceExpanded = false; referenceExpanded = false }
                    if value && scrollPosition.followsLatest { scroll(proxy) }
                }
                .task { await Task.yield(); if scrollPosition.followsLatest { scroll(proxy, animated: false) } }
        }.background(Color(uiColor: .systemBackground))
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .task { await reload() }
            .onChange(of: sourceExpanded) { _, expanded in if expanded && shortHeight { focused = false } }
            .onChange(of: referenceExpanded) { _, expanded in if expanded && shortHeight { focused = false } }
            .onChange(of: verticalSizeClass) { _, value in
                if value == .compact && focused { sourceExpanded = false; referenceExpanded = false }
            }
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
    private func conversationTurn(_ turn: ReaderConversationTurn) -> some View {
        ChatTurnView(turn: turn,
            responseText: turn.id == activeTurnID ? tools.responseText : "",
            responding: turn.id == activeTurnID && turn.status == "running" && (tools.generating || tools.loading),
            responseStatus: tools.responseStatus,
            error: turn.id == failedTurnID ? tools.error : nil,
            retry: tools.retry?.id == turn.id ? { retryRequest() } : nil,
            resolveVoice: { try await tools.voiceURL($0, cloud: cloud) }, playbackAllowed: !speech.isActive,
            onReference: { role in tools.referenceMessage(turn, role: role); referenceExpanded = false; composerAwake = true; focused = true },
            onLike: { role in tools.toggleMessageLike(turnID: turn.id, role: role) },
            isLiked: { role in tools.isMessageLiked(turnID: turn.id, role: role) })
    }
    private func reload() async {
        await load()
        if !Task.isCancelled { didLoad = true; if !tools.turns.isEmpty { composerAwake = false } }
    }
    private var composerIsCompact: Bool {
        !composerAwake && !focused && !tools.turns.isEmpty && tools.question.isEmpty && tools.pendingVoice == nil && tools.pendingMessageReference == nil && !speech.isActive && speech.error == nil && (tools.retry == nil || tools.generating || (tools.loading && tools.turns.last?.status == "running")) && tools.error == nil && tools.draftError == nil && !sendingVoice
    }
    private func submit() async {
        scrollPosition.resumeFollowing()
        focused = false; composerAwake = false
        await send()
    }
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
    private var showsLatest: Bool { !scrollPosition.followsLatest && !tools.turns.isEmpty }
    private func returnToLatest() { scrollPosition.resumeFollowing(); latestRequest = UUID() }
    private func latestButton(compact: Bool) -> some View {
        Button(action: returnToLatest) {
            Group {
                if compact { Image(systemName: "arrow.down").font(.system(size: 18, weight: .semibold)).frame(width: 44, height: 44) }
                else { Label("回到最新", systemImage: "arrow.down").font(.subheadline).lineLimit(1).frame(minHeight: 44) }
            }.contentShape(Rectangle())
        }.buttonStyle(.plain).foregroundStyle(Color.leafInk)
            .accessibilityLabel("回到最新").accessibilityHint("返回对话底部，继续跟随回答")
            .accessibilityIdentifier("chat-latest")
    }
    private var context: some View {
        HStack(alignment: .top, spacing: 6) {
            DisclosureGroup(isExpanded: $sourceExpanded) {
                ScrollView {
                    if shortHeight {
                        Text([bookTitle, sourceChapter, tools.chatContext?.sourceLabel ?? sourceLabel].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.caption2).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    Text(source).font(.subheadline).lineSpacing(5).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
                }.frame(maxHeight: 140)
            } label: {
                if shortHeight {
                    HStack(spacing: 6) {
                        Image(systemName: "text.quote").foregroundStyle(Color.leafInk)
                        Text(tools.chatContext?.selection?.origin == "translation" ? "译文" : "原文").foregroundStyle(.secondary).fixedSize()
                        Text(sourceExpanded ? "完整引用" : source).lineLimit(1)
                    }.font(.caption2).frame(minHeight: 44).contentShape(Rectangle())
                } else {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "text.quote").foregroundStyle(Color.leafInk).padding(.top, 2)
                    VStack(alignment: .leading, spacing: 4) {
                        if !sourceExpanded { Text(source).font(.subheadline).foregroundStyle(.primary).lineLimit(1) }
                        HStack(spacing: 6) {
                            Text([bookTitle, sourceChapter].filter { !$0.isEmpty }.joined(separator: " · ")).lineLimit(1)
                            if tools.chatContext?.selection?.origin == "translation" { Text("译文 · 随附原文").fixedSize() }
                        }.font(.caption2).foregroundStyle(.secondary)
                    }
                }
                }
            }.tint(Color.leafInk)
                .font(shortHeight ? .caption2 : .body)
            if (canRemoveSource || tools.chatContext?.selection != nil) && !tools.chatQuoteRemoved {
            Button { tools.removeChatSelection(); sourceExpanded = false } label: {
                Image(systemName: "xmark").font(.caption).frame(width: 44, height: 44).contentShape(Rectangle())
            }.buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel("移除本次引用")
                .accessibilityIdentifier("chat-remove-source").disabled(tools.generating || tools.loading || tools.retry != nil)
            }
        }.padding(.horizontal, 8).padding(.vertical, shortHeight ? 0 : 4)
            .overlay(alignment: .leading) { Rectangle().fill(Color.secondary.opacity(0.22)).frame(width: 1).padding(.vertical, 6) }
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
    @ViewBuilder private var composer: some View {
        if composerIsCompact {
            HStack(spacing: 12) {
                Button {
                    composerAwake = true; focused = true
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "square.and.pencil").font(.subheadline)
                        Text("继续问…").font(.subheadline).lineLimit(1)
                        Spacer(minLength: 0)
                    }.frame(minHeight: 44).contentShape(Rectangle())
                }.buttonStyle(.plain).foregroundStyle(.secondary).accessibilityIdentifier("chat-wake-composer")
                if showsLatest { latestButton(compact: true) }
                if tools.generating {
                    Button { Task { await tools.cancelConversation(cloud: cloud) } } label: {
                        Image(systemName: "stop.fill").frame(width: 44, height: 44)
                    }.buttonStyle(.plain).accessibilityLabel("停止回答").accessibilityIdentifier("reader-question-send")
                }
            }.padding(.horizontal, 24).background(Color(uiColor: .systemBackground))
        } else { expandedComposer }
    }
    private var hasSourceContext: Bool {
        !source.isEmpty && !tools.chatQuoteRemoved && (canRemoveSource || tools.chatContext?.selection != nil)
    }
    private var canUpdateContext: Bool { tools.canUpdateChatContext && tools.pendingMessageReference == nil }
    private var attachmentLayout: AnyLayout {
        shortHeight ? AnyLayout(HStackLayout(alignment: .top, spacing: 8)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
    }
    private func pendingReference(_ reference: ReaderMessageReference) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Group {
                if shortHeight {
                    DisclosureGroup(isExpanded: $referenceExpanded) {
                        ScrollView {
                            Text(reference.text).font(.subheadline).textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }.frame(maxHeight: 140)
                    } label: {
                        Text("回复 " + reference.authorLabel).font(.caption2).lineLimit(1).frame(minHeight: 44).contentShape(Rectangle())
                    }.font(.caption2)
                } else {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("回复 " + reference.authorLabel).font(.caption2).foregroundStyle(.secondary)
                        Text(reference.text).font(.subheadline).lineLimit(2)
                    }
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
            Button { tools.pendingMessageReference = nil; referenceExpanded = false } label: {
                Image(systemName: "xmark").frame(width: 44, height: 44).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityLabel("移除消息引用")
        }.padding(.leading, 10)
            .overlay(alignment: .leading) { Rectangle().fill(Color.leafInk.opacity(0.4)).frame(width: 2) }
            .accessibilityIdentifier("chat-message-reference")
    }
    private var expandedComposer: some View {
        VStack(alignment: .leading, spacing: shortHeight ? 2 : 6) {
            if hasSourceContext || tools.pendingMessageReference != nil || tools.pendingVoice != nil || canUpdateContext {
                attachmentLayout {
                    if hasSourceContext { context.frame(maxWidth: .infinity, alignment: .leading) }
                    if let reference = tools.pendingMessageReference { pendingReference(reference).frame(maxWidth: .infinity, alignment: .leading) }
                    if canUpdateContext {
                        Button("引用刚才选的文字", systemImage: "text.quote") { tools.updateChatContext(); sourceExpanded = false }
                            .font(shortHeight ? .caption2 : .caption).lineLimit(1).frame(minHeight: 44)
                    }
                    if let voice = tools.pendingVoice {
                        HStack(spacing: 8) {
                            Label("语音 · \(max(1, voice.durationMs / 1000)) 秒", systemImage: "waveform")
                                .font(shortHeight ? .caption2 : .caption).lineLimit(1)
                            Spacer(minLength: 0)
                            Button("移除语音", systemImage: "xmark.circle.fill") { tools.pendingVoice = nil }
                                .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44).disabled(tools.generating || sendingVoice)
                        }.foregroundStyle(.secondary).padding(.horizontal, shortHeight ? 0 : 12)
                    }
                }
            }
            if showsLatest && !(shortHeight && focused) { HStack { Spacer(minLength: 0); latestButton(compact: false) } }
            HStack(alignment: .bottom, spacing: 8) {
                Button {
                    if speech.isActive { tools.question = speech.cancel() }
                    else { focused = false; Task { await speech.start(draft: tools.question) { tools.question = $0 } } }
                } label: {
                    Image(systemName: speech.isActive ? "xmark" : "mic.fill").font(.system(size: 17, weight: .medium))
                        .frame(width: 44, height: 44).contentShape(Rectangle()).foregroundStyle(speech.isActive ? Color.red : Color.secondary)
                }.buttonStyle(.plain).disabled(localOnly || tools.loading || tools.generating || tools.retry != nil || tools.pendingVoice != nil || sendingVoice)
                    .accessibilityLabel(speech.isActive ? "取消本次录音" : "语音输入").accessibilityIdentifier("chat-microphone")
                if shortHeight && focused {
                    Button { focused = false } label: {
                        Image(systemName: "keyboard.chevron.compact.down").font(.system(size: 18)).frame(width: 44, height: 44).contentShape(Rectangle())
                    }.buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel("收起键盘")
                        .accessibilityIdentifier("chat-dismiss-keyboard")
                }
                TextField(isLibraryConversation ? "和松鼠聊聊…" : "写下此刻的问题", text: $tools.question, axis: .vertical)
                    .lineLimit(composerLines).focused($focused).padding(.vertical, shortHeight ? 0 : 12)
                    .disabled(speech.isActive || sendingVoice)
                    .accessibilityAction(named: Text("收起键盘")) { focused = false }
                    .accessibilityIdentifier("reader-question").layoutPriority(1)
                Button { Task { if tools.generating { await tools.cancelConversation(cloud: cloud) } else if speech.recording { await captureVoice(sendAfter: true) } else { await submit() } } } label: {
                    Group { if sendingVoice || speech.finishing { ProgressView() } else { Image(systemName: tools.generating ? "stop.fill" : "arrow.up").font(.system(size: tools.generating ? 14 : 17, weight: .semibold)) } }
                        .frame(width: 44, height: 44)
                        .foregroundStyle(canAsk || speech.recording || tools.generating ? Color.primary : Color.secondary)
                        .background(canAsk || speech.recording || tools.generating ? Color.primary.opacity(0.06) : .clear, in: RoundedRectangle(cornerRadius: 10))
                        .contentShape(Rectangle())
                }.buttonStyle(.plain).disabled((!canAsk && !speech.recording && !tools.generating) || speech.preparing || speech.finishing || sendingVoice)
                    .accessibilityLabel(tools.generating ? "停止回答" : speech.recording ? "发送语音和文字" : "发送消息").accessibilityIdentifier("reader-question-send")
            }.padding(.leading, 3).padding(.trailing, 6).padding(.vertical, 4)
                .background(Color(uiColor: .secondarySystemBackground).opacity(0.5), in: RoundedRectangle(cornerRadius: 16))
                .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(Color.primary.opacity(0.12), lineWidth: 0.5) }
            if speech.isActive { Text(speech.preparing ? "正在打开麦克风…" : speech.finishing ? "正在整理语音…" : "正在录音 · 点麦克风取消，点箭头发送").font(.caption).foregroundStyle(.secondary).padding(.horizontal, 8) }
            if let error = speech.error { Text(error).font(.caption).foregroundStyle(.secondary).padding(.horizontal, 8) }
        }.frame(maxWidth: 680).padding(.horizontal, 16).padding(.vertical, shortHeight ? 2 : 10).frame(maxWidth: .infinity)
            .background(Color(uiColor: .systemBackground))
            .background { GeometryReader { geometry in Color.clear.preference(key: CompanionComposerHeightKey.self, value: geometry.size.height) } }
    }
    private func captureVoice(sendAfter: Bool) async {
        guard !sendingVoice else { return }; sendingVoice = true; defer { sendingVoice = false }
        do {
            let recording = try await speech.finish()
            try await tools.attachVoice(recording)
            sendingVoice = false
            if sendAfter && !tools.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { await submit() }
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
    let onReference: (String) -> Void
    let onLike: (String) -> Void
    let isLiked: (String) -> Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 24) {
                Spacer(minLength: 24)
            VStack(alignment: .leading, spacing: 6) {
                if let voice = turn.voice {
                    ChatVoiceMessageView(voice: voice, resolve: { try await resolveVoice(voice) }, playbackAllowed: playbackAllowed)
                    Text("转写文字").font(.caption2).foregroundStyle(.secondary)
                }
                if let reference = turn.replyTo { ChatMessageReferenceView(reference: reference) }
                if let quote = turn.quote { ChatSavedQuoteView(quote: quote) }
                ChatMarkdownView(source: turn.question, plainText: true,
                    onReference: { onReference("user") }, onLike: { onLike("user") }, liked: isLiked("user"))
                    .accessibilityIdentifier("chat-user-message-" + turn.id)
                if isLiked("user") { Image(systemName: "hand.thumbsup.fill").font(.caption2).foregroundStyle(Color.leafInk).accessibilityLabel("已点赞") }
            }.padding(.leading, 12).padding(.vertical, 8)
                .overlay(alignment: .leading) { Rectangle().fill(Color.leafInk.opacity(0.18)).frame(width: 1) }
                .contextMenu { messageActions(role: "user", text: turn.question) }
                .accessibilityAction(named: Text("引用消息")) { onReference("user") }
                .accessibilityAction(named: Text(isLiked("user") ? "取消点赞" : "点赞")) { onLike("user") }
            }
            VStack(alignment: .leading, spacing: 8) {
                if let answer = turn.answer, !answer.isEmpty {
                    ChatMarkdownView(source: answer,
                        onReference: turn.status == "completed" ? { onReference("assistant") } : nil,
                        onLike: { onLike("assistant") }, liked: isLiked("assistant"))
                        .accessibilityAction(named: Text("引用消息")) { if turn.status == "completed" { onReference("assistant") } }
                        .accessibilityAction(named: Text(isLiked("assistant") ? "取消点赞" : "点赞")) { onLike("assistant") }
                        .accessibilityIdentifier("chat-assistant-message-" + turn.id)
                    if isLiked("assistant") { Image(systemName: "hand.thumbsup.fill").font(.caption2).foregroundStyle(Color.leafInk).accessibilityLabel("已点赞") }
                } else if !responseText.isEmpty { ChatMarkdownView(source: responseText) }
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
    @ViewBuilder private func messageActions(role: String, text: String) -> some View {
        Button("引用", systemImage: "arrowshape.turn.up.left") { onReference(role) }.disabled(role == "assistant" && turn.status != "completed")
        Button("复制", systemImage: "doc.on.doc") { UIPasteboard.general.string = text }
        Button(isLiked(role) ? "取消点赞" : "点赞", systemImage: isLiked(role) ? "hand.thumbsup.fill" : "hand.thumbsup") { onLike(role) }
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
        }.padding(.leading, 10)
            .overlay(alignment: .leading) { Rectangle().fill(Color.secondary.opacity(0.3)).frame(width: 1) }
            .accessibilityIdentifier("chat-saved-quote")
    }
}

private struct ChatMessageReferenceView: View {
    let reference: ReaderMessageReference
    @State private var expanded = false
    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            Text(reference.text).font(.subheadline).textSelection(.enabled)
        } label: {
            VStack(alignment: .leading, spacing: 3) {
                Text("回复 " + reference.authorLabel).font(.caption2).foregroundStyle(.secondary)
                if !expanded { Text(reference.text).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
            }
        }.tint(.secondary).accessibilityIdentifier("chat-saved-message-reference")
    }
}
