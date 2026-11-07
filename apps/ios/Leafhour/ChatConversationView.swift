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
    func pauseFollowing() {
        cancelLegacySettlement(); legacyGestureActive = false
        followsLatest = false; userScrolling = false; layoutAtStart = nil
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
            .background(ChatLegacyScrollObserver(
                begin: { position.beginLegacyBrowsing(layout: fallbackLayout) },
                end: { position.endLegacyBrowsing(layout: fallbackLayout) }))
            .onDisappear { position.cancelLegacyBrowsing() }
        }
    }
    private func updateLegacyPosition(_ frame: CGRect, layout: ChatScrollLayout) {
        guard !frame.isNull, layout.container.height > 0 else { return }
        let visibleBottom = layout.container.height - max(0, layout.insets.bottom)
        position.updateLegacyBottomVisibility(frame.maxY <= visibleBottom + 44, layout: layout)
    }
}

/// Observe the existing vertical pan on iOS 17; adding a SwiftUI drag here
/// would also recognize horizontal movement and compete with the root pager.
private struct ChatLegacyScrollObserver: UIViewRepresentable {
    let begin: () -> Void
    let end: () -> Void
    func makeUIView(context: Context) -> ObserverView { ObserverView() }
    func updateUIView(_ view: ObserverView, context: Context) {
        view.begin = begin; view.end = end; view.attach()
    }
    static func dismantleUIView(_ view: ObserverView, coordinator: ()) { view.detach() }
    final class ObserverView: UIView {
        var begin: (() -> Void)?
        var end: (() -> Void)?
        private weak var scroll: UIScrollView?
        private var browsing = false
        override func didMoveToWindow() { super.didMoveToWindow(); attach() }
        override func layoutSubviews() { super.layoutSubviews(); attach() }
        func attach() {
            var ancestor = superview
            while let view = ancestor {
                if let candidate = view as? UIScrollView {
                    guard scroll !== candidate else { return }
                    detach(); scroll = candidate
                    candidate.panGestureRecognizer.addTarget(self, action: #selector(panned(_:)))
                    return
                }
                ancestor = view.superview
            }
        }
        func detach() { scroll?.panGestureRecognizer.removeTarget(self, action: #selector(panned(_:))); scroll = nil; browsing = false }
        @objc private func panned(_ pan: UIPanGestureRecognizer) {
            let delta = pan.translation(in: self)
            if pan.state == .changed, !browsing, abs(delta.y) > 8, abs(delta.y) > abs(delta.x) {
                browsing = true; begin?()
            }
            if [.ended, .cancelled, .failed].contains(pan.state), browsing { browsing = false; end?() }
        }
    }
}

private struct ChatScrollAnchoring: ViewModifier {
    let followsLatest: Bool
    let marginal: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 18, *) {
            content.defaultScrollAnchor(marginal ? .top : .bottom, for: .initialOffset)
                .defaultScrollAnchor(marginal ? .top : .bottom, for: .alignment)
                .defaultScrollAnchor(followsLatest ? .bottom : .top, for: .sizeChanges)
        } else {
            content.defaultScrollAnchor(followsLatest && !marginal ? .bottom : .top)
        }
    }
}

private struct ChatReadingEdges: ViewModifier {
    @ViewBuilder func body(content: Content) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26, *) { content.scrollEdgeEffectHidden() }
        else { content }
        #else
        content
        #endif
    }
}

/// Configure only the owning history scroll view. Short conversations have no
/// empty drag range, and long conversations stop at their first/last message.
private struct ChatHistoryScrollBoundary: UIViewRepresentable {
    func makeUIView(context: Context) -> BoundaryView { BoundaryView() }
    func updateUIView(_ view: BoundaryView, context: Context) { view.attach() }
    final class BoundaryView: UIView {
        override func didMoveToWindow() { super.didMoveToWindow(); attach() }
        override func layoutSubviews() { super.layoutSubviews(); attach() }
        func attach() {
            var ancestor = superview
            while let view = ancestor {
                if let history = view as? UIScrollView {
                    history.bounces = false
                    history.alwaysBounceVertical = false
                    return
                }
                ancestor = view.superview
            }
        }
    }
}

private struct ChatTargetFrameKey: PreferenceKey {
    static var defaultValue: CGRect = .null
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) { let next = nextValue(); if !next.isNull { value = next } }
}

/// One conversation surface serves both global Chat and an anchored selection.
struct ChatConversationView: View {
    @Bindable var tools: ReaderCloudTools
    let cloud: CloudLibraryClient?
    var title = "旁注"
    let bookTitle: String
    let source: String
    var sourceChapter = ""
    var canRemoveSource = false
    var sourceLabel = "引用的原文"
    var localOnly = false
    var isLibraryConversation = false
    var isMarginalNote = false
    var readingGuide: ReadingGuideController? = nil
    var targetTurnID: String? = nil
    var onTargetDisplayed: ((String) -> Void)? = nil
    var onGuideFollowUp: ((ChatFollowUp) async -> Void)? = nil
    var onSignIn: (() -> Void)? = nil
    var autoLoad = true
    let load: () async -> Void
    let send: () async -> Void
    @State private var targetPlaced = false
    @State private var historySize = CGSize.zero
    @State private var targetFrame = CGRect.null
    @State private var composerAwake = true
    @State private var didLoad = false
    @State private var sourceExpanded = false
    @State private var referenceExpanded = false
    @State private var speech = ChatSpeechRecorder()
    @State private var sendingVoice = false
    @State private var scrollPosition = ChatScrollState()
    @State private var latestRequest = UUID()
    @State private var expandedQuestions = Set<String>()
    @State private var placedMarginalReply: String?
    @State private var selectingMessages = false
    @State private var selectedMessages = Set<String>()
    @State private var shareSelection: ChatShareSelection?
    @State private var messageNotice: String?
    @FocusState private var focused: Bool
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    private var shortHeight: Bool { verticalSizeClass == .compact }
    private var composerLines: ClosedRange<Int> {
        guard shortHeight else { return 1...6 }
        return 1...(focused || sourceExpanded || referenceExpanded ? 1 : 3)
    }
    private var canAsk: Bool {
        !localOnly && !tools.loading && !tools.generating && !tools.sendingFollowUp && tools.retry == nil && tools.conversationAvailable && !tools.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if let readingGuide {
                        ReaderReadingGuideContent(controller: readingGuide, canSend: !tools.generating && !tools.loading && !tools.sendingFollowUp && tools.retry == nil, onFollowUp: { item in
                            scrollPosition.resumeFollowing()
                            await onGuideFollowUp?(item)
                        }).id("reading-guide-top")
                        Divider()
                    }
                    if tools.turns.count > 2 {
                        LazyVStack(alignment: .leading, spacing: 24) {
                            ForEach(tools.turns.dropLast(2)) { turn in conversationTurn(turn) }
                        }
                    }
                    // A long live exchange must not become the lazy stack's row
                    // height estimate. Measure it outside older, lazy history.
                    VStack(alignment: .leading, spacing: 24) {
                        ForEach(tools.turns.suffix(2)) { turn in conversationTurn(turn) }
                        status
                        Color.clear.frame(height: 1).modifier(ChatBottomMarker(position: scrollPosition))
                    }.id("chat-bottom")
                }.frame(maxWidth: 680).padding(.horizontal, 20).padding(.vertical, 20).frame(maxWidth: .infinity)
                    .background(ChatHistoryScrollBoundary())
            }.modifier(ChatReadingEdges()).accessibilityIdentifier("reader-conversation-history")
                .coordinateSpace(name: "conversation-scroll")
                .background { GeometryReader { geometry in
                    Color.clear.onAppear { historySize = geometry.size }.onChange(of: geometry.size) { _, size in historySize = size }
                } }
                .onPreferenceChange(ChatTargetFrameKey.self) { frame in targetFrame = frame; acknowledgeVisibleTarget() }
                .onChange(of: historySize) { _, _ in acknowledgeVisibleTarget() }
                .onChange(of: tools.quickQuestionStatus) { _, _ in acknowledgeVisibleTarget() }
                .onChange(of: didLoad) { _, ready in if ready { placeTarget(proxy) } }
                .onChange(of: tools.turns.count) { _, _ in placeTarget(proxy) }
                .modifier(ChatScrollTracking(position: scrollPosition))
                .modifier(ChatScrollAnchoring(followsLatest: scrollPosition.followsLatest, marginal: isMarginalNote))
                .onChange(of: scrollPosition.followsLatest) { _, follows in
                    if !follows && !focused { composerAwake = false }
                }
                .scrollDismissesKeyboard(.interactively)
                .safeAreaInset(edge: .bottom, spacing: 0) { if selectingMessages { selectionBar } else { composer } }
                .onChange(of: latestRequest) { _, _ in scroll(proxy) }
                .onChange(of: tools.turns.last?.id) { _, _ in
                    if !placeCompletedMarginalReply(proxy), scrollPosition.followsLatest { scroll(proxy) }
                }
                .onChange(of: tools.turns.last?.status) { _, _ in
                    if !placeCompletedMarginalReply(proxy), scrollPosition.followsLatest { scroll(proxy) }
                }
                .onChange(of: tools.generating) { _, value in if value && scrollPosition.followsLatest { scroll(proxy) } }
                .onChange(of: tools.responseText) { _, value in
                    // Follow only from the bottom. Reading or selecting an earlier
                    // answer must not be interrupted by each incoming text delta.
                    if isMarginalNote, !value.isEmpty, let id = activeTurnID, placedMarginalReply != id {
                        placedMarginalReply = id
                        if scrollPosition.followsLatest { scrollPosition.pauseFollowing(); scrollToReply(id, proxy: proxy) }
                    } else if scrollPosition.followsLatest { scroll(proxy, animated: false) }
                }
                .onChange(of: focused) { _, value in
                    if value && shortHeight { sourceExpanded = false; referenceExpanded = false }
                    if value && scrollPosition.followsLatest { scroll(proxy) }
                }
                .task {
                    await Task.yield()
                    if targetTurnID != nil { placeTarget(proxy) }
                    else if readingGuide != nil {
                        scrollPosition.pauseFollowing(); proxy.scrollTo("reading-guide-top", anchor: .top)
                    } else if !placeCompletedMarginalReply(proxy), scrollPosition.followsLatest { scroll(proxy, animated: false) }
                }
        }.background(Color(uiColor: .systemBackground))
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color(uiColor: .systemBackground), for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .task {
                if autoLoad { await reload() }
                else { didLoad = true; if !tools.turns.isEmpty { composerAwake = false } }
            }
            .sheet(item: $shareSelection) { selection in ChatSharePanel(selection: selection) }
            .sensoryFeedback(.selection, trigger: tools.reactionRevision)
            .overlay(alignment: .top) {
                if let messageNotice { Text(messageNotice).font(.caption).padding(.horizontal, 14).padding(.vertical, 9).background(.regularMaterial, in: Capsule()).padding(.top, 8).allowsHitTesting(false).accessibilityIdentifier("chat-message-notice") }
            }
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
        ChatTurnView(turn: turn, isQuickTarget: turn.id == targetTurnID,
            responseText: turn.id == activeTurnID ? tools.responseText : "",
            responding: turn.id == activeTurnID && turn.status == "running" && (tools.generating || tools.loading),
            responseStatus: tools.responseStatus,
            error: turn.id == failedTurnID ? tools.error : nil,
            retry: tools.retry?.id == turn.id ? { retryRequest() } : nil,
            followUpsEnabled: !localOnly && tools.canSendFollowUps && !speech.isActive && !sendingVoice && !selectingMessages,
            onFollowUp: { item in
                guard !speech.isActive, !sendingVoice, !selectingMessages else { return }
                scrollPosition.resumeFollowing(); focused = false; composerAwake = false
                Task { await tools.sendFollowUp(item, parent: turn, cloud: cloud) }
            },
            resolveVoice: { try await tools.voiceURL($0, cloud: cloud) }, playbackAllowed: !speech.isActive,
            onReference: { role in tools.referenceMessage(turn, role: role); referenceExpanded = false; composerAwake = true; focused = true },
            onLike: { role in tools.toggleMessageLike(turnID: turn.id, role: role) },
            isLiked: { role in tools.isMessageLiked(turnID: turn.id, role: role) },
            reaction: { role in tools.messageReaction(turnID: turn.id, role: role) },
            onReact: { role, emoji in
                tools.setMessageReaction(turnID: turn.id, role: role, emoji: emoji)
                showNotice(tools.messageReaction(turnID: turn.id, role: role) == nil ? "已取消标记" : "已标记 · 下次发送时松鼠会看到")
            },
            selecting: selectingMessages,
            isSelected: { role in selectedMessages.contains(turn.id + ":" + role) },
            onSelect: { role in
                selectingMessages = true; focused = false
                let key = turn.id + ":" + role
                if selectedMessages.contains(key) { selectedMessages.remove(key) } else { selectedMessages.insert(key) }
            },
            onShare: { role in presentShare(ids: [turn.id + ":" + role]) },
            questionExpanded: Binding(get: { expandedQuestions.contains(turn.id) }, set: { expanded in
                if expanded { scrollPosition.pauseFollowing(); expandedQuestions.insert(turn.id) } else { expandedQuestions.remove(turn.id) }
            }))
            .id(turn.id)
    }
    private var chosenMessages: [ChatShareMessage] { ChatShareMessage.ordered(tools.turns).filter { selectedMessages.contains($0.id) } }
    private var selectionBar: some View {
        VStack(spacing: 8) {
            HStack {
                Button("取消") { selectingMessages = false; selectedMessages.removeAll() }.frame(minHeight: 44)
                Spacer()
                Text("已选 \(chosenMessages.count) 条").font(.subheadline)
                Spacer()
                Button("全选") { selectedMessages = Set(ChatShareMessage.ordered(tools.turns).map(\.id)) }.frame(minHeight: 44)
            }
            HStack(spacing: 16) {
                Button { UIPasteboard.general.string = chosenMessages.map(\.attributedText).joined(separator: "\n\n"); showNotice("已复制所选消息") } label: { Label("复制", systemImage: "doc.on.doc").frame(maxWidth: .infinity).frame(minHeight: 44) }
                Button { presentShare(ids: selectedMessages) } label: { Label("分享 / 转发", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity).frame(minHeight: 44) }
            }.buttonStyle(.bordered).disabled(chosenMessages.isEmpty)
        }.padding(.horizontal, 20).padding(.bottom, 8).background(.bar)
    }
    private func presentShare(ids: Set<String>) {
        let all = ChatShareMessage.ordered(tools.turns), chosen = all.filter { ids.contains($0.id) }
        guard !chosen.isEmpty else { return }
        var before: String?, after: String?
        if chosen.count == 1, let index = all.firstIndex(where: { $0.id == chosen[0].id }) {
            if index > 0 { before = all[index - 1].contextExcerpt(fromEnd: true) }
            if index + 1 < all.count { after = all[index + 1].contextExcerpt(fromEnd: false) }
        }
        shareSelection = ChatShareSelection(title: bookTitle.isEmpty ? "和松鼠的一段对话" : bookTitle, messages: chosen, before: before, after: after)
    }
    private func showNotice(_ text: String) {
        messageNotice = text
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            if messageNotice == text { messageNotice = nil }
        }
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
    private func acknowledgeVisibleTarget() {
        guard let targetTurnID, !targetFrame.isNull, historySize.height > 0,
              targetFrame.intersects(CGRect(origin: .zero, size: historySize)),
              tools.turns.contains(where: { $0.id == targetTurnID && $0.status == "completed" && $0.answer?.isEmpty == false }) else { return }
        onTargetDisplayed?(targetTurnID)
    }
    private func placeTarget(_ proxy: ScrollViewProxy) {
        guard !targetPlaced, let targetTurnID, tools.turns.contains(where: { $0.id == targetTurnID }) else { return }
        targetPlaced = true; placedMarginalReply = targetTurnID; scrollPosition.pauseFollowing()
        proxy.scrollTo(targetTurnID, anchor: .top)
        Task { @MainActor in
            await Task.yield()
            proxy.scrollTo("chat-reply-" + targetTurnID, anchor: .top)
        }
    }
    private func scroll(_ proxy: ScrollViewProxy, animated: Bool = true) {
        withAnimation(animated && !reduceMotion ? .easeOut(duration: 0.2) : nil) { proxy.scrollTo("chat-bottom", anchor: .bottom) }
    }
    private func scrollToReply(_ id: String, proxy: ScrollViewProxy) {
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { proxy.scrollTo("chat-reply-" + id, anchor: .top) }
    }
    private func placeCompletedMarginalReply(_ proxy: ScrollViewProxy) -> Bool {
        guard isMarginalNote, scrollPosition.followsLatest, let last = tools.turns.last,
              last.status == "completed", placedMarginalReply != last.id else { return false }
        placedMarginalReply = last.id
        scrollPosition.pauseFollowing()
        scrollToReply(last.id, proxy: proxy)
        return true
    }
    private var showsLatest: Bool {
        !scrollPosition.followsLatest && !tools.turns.isEmpty
            && (!isMarginalNote || !composerIsCompact || !scrollPosition.isAtLatest)
    }
    private func returnToLatest() { scrollPosition.resumeFollowing(); latestRequest = UUID() }
    private func latestButton(compact: Bool) -> some View {
        Button(action: returnToLatest) {
            Group {
                if compact { Image(systemName: "arrow.down").font(.system(size: 18, weight: .semibold)).frame(width: 44, height: 44) }
                else { Label("回到最新", systemImage: "arrow.down").font(.subheadline).lineLimit(1).frame(minHeight: 48) }
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
                            .font(.caption2).foregroundStyle(Color.primary.opacity(0.64)).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    Text(source).font(.subheadline).lineSpacing(5).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
                }.frame(maxHeight: 140)
            } label: {
                if shortHeight {
                    HStack(spacing: 6) {
                        Image(systemName: "text.quote").foregroundStyle(Color.leafInk)
                        Text(tools.chatContext?.selection?.origin == "translation" ? "译文" : "原文").foregroundStyle(Color.leafInk).fixedSize()
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
                        }.font(.caption2).foregroundStyle(Color.primary.opacity(0.64))
                    }
                }
                }
            }.tint(Color.leafInk)
                .font(shortHeight ? .caption2 : .body)
            if (canRemoveSource || tools.chatContext?.selection != nil) && !tools.chatQuoteRemoved {
            Button { tools.removeChatSelection(); sourceExpanded = false } label: {
                Image(systemName: "xmark").font(.caption).frame(width: 44, height: 44).contentShape(Rectangle())
            }.buttonStyle(.plain).foregroundStyle(Color.primary.opacity(0.64)).accessibilityLabel("移除本次引用")
                .accessibilityIdentifier("chat-remove-source").disabled(tools.generating || tools.loading || tools.retry != nil)
            }
        }.padding(.horizontal, 8).padding(.vertical, shortHeight ? 0 : 4)
            .overlay(alignment: .leading) { Rectangle().fill(Color.secondary.opacity(0.22)).frame(width: 1).padding(.vertical, 6) }
            .accessibilityElement(children: .contain).accessibilityIdentifier("chat-source-context")
    }
    @ViewBuilder private var status: some View {
        if let pending = tools.pendingQuickRecording {
            VStack(alignment: .leading, spacing: 8) {
                Text("原录音尚未归档").font(.subheadline)
                if !pending.recording.transcript.isEmpty { Text(pending.recording.transcript).font(.footnote).textSelection(.enabled) }
                HStack {
                    Button(pending.sendAfterRetention == true ? "重试保存并送出" : "重试保留录音") { Task { await tools.retryQuickRecording(cloud: cloud) } }.disabled(tools.quickSubmitting)
                    Spacer()
                    ShareLink(item: pending.recording.url) { Label("导出原录音", systemImage: "square.and.arrow.up") }
                }.frame(minHeight: 44)
                Button("取消这条录音") { Task { await tools.discardQuickRecording() } }.frame(minHeight: 44)
            }.accessibilityIdentifier("quick-recording-recovery")
        }

        if let draft = tools.quickVoiceDraft {
            VStack(alignment: .leading, spacing: 8) {
                Text("语音已保留").font(.subheadline)
                TextField("补充转写文字后发送", text: Binding(get: { tools.quickVoiceDraft?.text ?? "" }, set: { tools.editQuickTranscript($0) }), axis: .vertical)
                    .textFieldStyle(.roundedBorder).accessibilityIdentifier("quick-voice-transcript")
                HStack {
                    Button("发送这条语音") { Task { await tools.sendQuickVoiceDraft(cloud: cloud) } }
                        .disabled(draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || tools.generating || tools.quickSubmitting)
                    Spacer()
                    Button("取消这条语音") { tools.discardQuickVoice() }.disabled(tools.generating || tools.quickSubmitting)
                }.frame(minHeight: 44)
            }.padding(.vertical, 8).accessibilityIdentifier("quick-voice-recovery")
        }

        if tools.generating && tools.turns.isEmpty { ProgressView(tools.responseStatus ?? "正在回答…").font(.caption).accessibilityIdentifier("chat-generating") }
        else if tools.turns.isEmpty && (tools.loading || !didLoad) { ProgressView("正在读取对话…").font(.caption) }
        else if tools.turns.isEmpty && tools.error == nil {
            Text(isLibraryConversation ? "书里的一句话，或此刻的一个念头。" : localOnly ? "登录后可以继续提问，输入的文字会保留。" : "想聊聊这段里的什么？")
                .font(.subheadline).foregroundStyle(Color.primary.opacity(0.64)).padding(.vertical, 12)
                .accessibilityIdentifier(isLibraryConversation ? "chat-companion-greeting" : "reader-conversation-greeting")
        }
        if isLibraryConversation && localOnly {
            Button("登录后继续聊", systemImage: "person.crop.circle") { onSignIn?() }.frame(minHeight: 44)
        } else if !localOnly && didLoad && !tools.loading && !tools.conversationAvailable && tools.error == nil {
            Button("重新连接") { Task { await reload() } }.font(.subheadline).frame(minHeight: 44)
        }
        if let error = tools.error, failedTurnID == nil, !tools.generating {
            VStack(alignment: .leading, spacing: 4) {
                Text(error).font(.caption).foregroundStyle(Color.primary.opacity(0.64)).textSelection(.enabled)
                if tools.retry == nil { Button("重试") { Task { await reload() } }.font(.subheadline).frame(minHeight: 44).disabled(tools.loading) }
            }.accessibilityIdentifier("reader-conversation-error")
        }
        if tools.retry != nil && !tools.turns.contains(where: { $0.id == tools.retry?.id }) && !tools.generating {
            Button("重试", systemImage: "arrow.clockwise") { retryRequest() }
                .font(.subheadline).frame(minHeight: 44).disabled(tools.loading)
        }
        if let error = tools.draftError {
            Text(error).font(.footnote).foregroundStyle(Color.primary.opacity(0.64))
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
                    }.frame(minHeight: 48).contentShape(Rectangle())
                }.buttonStyle(.plain).foregroundStyle(Color.primary.opacity(0.64)).accessibilityIdentifier("chat-wake-composer")
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
    private var hasComposerAttachments: Bool {
        hasSourceContext || tools.pendingMessageReference != nil || tools.pendingVoice != nil || canUpdateContext
    }
    private var compactAttachmentButton: some View {
        Button {
            focused = false
            sourceExpanded = hasSourceContext
            referenceExpanded = tools.pendingMessageReference != nil
        } label: {
            Image(systemName: "paperclip").font(.system(size: 18))
                .frame(width: 44, height: 44).contentShape(Rectangle())
        }.buttonStyle(.plain).foregroundStyle(Color.leafInk)
            .accessibilityLabel("查看本次引用与附件")
            .accessibilityHint("收起键盘，查看或移除已附加的内容；保留草稿")
            .accessibilityIdentifier("chat-inspect-attachments")
    }
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
                        Text("回复 " + reference.authorLabel).font(.caption2).foregroundStyle(Color.primary.opacity(0.64))
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
            if hasComposerAttachments && !(shortHeight && focused) {
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
                        }.foregroundStyle(Color.primary.opacity(0.64)).padding(.horizontal, shortHeight ? 0 : 12)
                    }
                }
            }
            if showsLatest && !shortHeight { HStack { Spacer(minLength: 0); latestButton(compact: false) } }
            HStack(alignment: .bottom, spacing: 8) {
                if shortHeight && focused && hasComposerAttachments {
                    compactAttachmentButton
                } else {
                Button {
                    if speech.isActive { tools.question = speech.cancel() }
                    else { focused = false; Task { await speech.start(draft: tools.question) { tools.question = $0 } } }
                } label: {
                    Image(systemName: speech.isActive ? "xmark" : "mic.fill").font(.system(size: 17, weight: .medium))
                        .frame(width: 44, height: 44).contentShape(Rectangle()).foregroundStyle(speech.isActive ? Color.red : Color.secondary)
                }.buttonStyle(.plain).disabled(localOnly || tools.loading || tools.generating || tools.retry != nil || tools.pendingVoice != nil || sendingVoice)
                    .accessibilityLabel(speech.isActive ? "取消本次录音" : "语音输入").accessibilityIdentifier("chat-microphone")
                }
                if focused {
                    Button { focused = false } label: {
                        Image(systemName: "keyboard.chevron.compact.down").font(.system(size: 18)).frame(width: 44, height: 44).contentShape(Rectangle())
                    }.buttonStyle(.plain).foregroundStyle(Color.primary.opacity(0.64)).accessibilityLabel("收起键盘")
                        .accessibilityIdentifier("chat-dismiss-keyboard")
                } else if shortHeight && showsLatest {
                    latestButton(compact: true)
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
            if speech.isActive { Text(speech.preparing ? "正在打开麦克风…" : speech.finishing ? "正在整理语音…" : "正在录音 · 点麦克风取消，点箭头发送").font(.caption).foregroundStyle(Color.primary.opacity(0.64)).padding(.horizontal, 8) }
            if let error = speech.error { Text(error).font(.caption).foregroundStyle(Color.primary.opacity(0.64)).padding(.horizontal, 8) }
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
    var isQuickTarget = false
    var responseText = ""
    var responding = false
    var responseStatus: String?
    var error: String?
    var retry: (() -> Void)?
    let followUpsEnabled: Bool
    let onFollowUp: (ChatFollowUp) -> Void
    let resolveVoice: (ChatVoiceReceipt) async throws -> URL
    let playbackAllowed: Bool
    let onReference: (String) -> Void
    let onLike: (String) -> Void
    let isLiked: (String) -> Bool
    let reaction: (String) -> String?
    let onReact: (String, String) -> Void
    let selecting: Bool
    let isSelected: (String) -> Bool
    let onSelect: (String) -> Void
    let onShare: (String) -> Void
    @Binding var questionExpanded: Bool
    private var foldsQuestion: Bool { turn.question.count > 240 }
    private var shownQuestion: String {
        foldsQuestion && !questionExpanded ? String(turn.question.prefix(96)).trimmingCharacters(in: .whitespacesAndNewlines) + "…" : turn.question
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if !turn.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || turn.voice != nil || turn.quote != nil {
            VStack(alignment: .leading, spacing: 5) {
                Text("你问").font(.caption2).foregroundStyle(Color.primary.opacity(0.64))
                if let voice = turn.voice {
                    ChatVoiceMessageView(voice: voice, resolve: { try await resolveVoice(voice) }, playbackAllowed: playbackAllowed)
                    Text("转写文字").font(.caption2).foregroundStyle(Color.primary.opacity(0.64))
                }
                if let reference = turn.replyTo { ChatMessageReferenceView(reference: reference) }
                if let guide = turn.guideContext, guide.isResolved {
                    DisclosureGroup("引用的 AI 阅读前导 · 开篇取样") {
                        Text(guide.text).font(.subheadline).textSelection(.enabled)
                    }.font(.caption).accessibilityIdentifier("chat-guide-context-" + turn.id)
                }
                if let quote = turn.quote { ChatSavedQuoteView(quote: quote) }
                ChatMarkdownView(source: shownQuestion, plainText: true, copySource: turn.question,
                    onReference: { onReference("user") }, onLike: { onLike("user") }, liked: isLiked("user"),
                    onReact: { onReact("user", $0) }, onSelectMessage: { onSelect("user") }, onShareMessage: { onShare("user") })
                    .accessibilityIdentifier("chat-user-message-" + turn.id)
                if foldsQuestion {
                    Button {
                        questionExpanded.toggle()
                    } label: {
                        Label(questionExpanded ? "收起问题" : "展开完整问题", systemImage: questionExpanded ? "chevron.up" : "chevron.down")
                            .font(.caption).frame(minHeight: 44).contentShape(Rectangle())
                    }.buttonStyle(.plain).foregroundStyle(Color.leafInk)
                        .accessibilityIdentifier("chat-question-expand")
                }
                reactionBadge(role: "user")
            }.padding(.vertical, 8).padding(.bottom, 8)
                .overlay(alignment: .bottom) { Rectangle().fill(Color.primary.opacity(0.12)).frame(height: 0.5) }
                .padding(.leading, selecting ? 38 : 0)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .leading) { if selecting { selectionButton(role: "user") } }
                .contextMenu { messageActions(role: "user", text: turn.question) }
                .accessibilityAction(named: Text("引用消息")) { onReference("user") }
                .accessibilityAction(named: Text("多选消息")) { onSelect("user") }
                .accessibilityAction(named: Text("分享消息")) { onShare("user") }
                .accessibilityAction(named: Text(isLiked("user") ? "取消点赞" : "点赞")) { onLike("user") }
            }
            VStack(alignment: .leading, spacing: 8) {
                if let answer = turn.answer, !answer.isEmpty {
                    ChatMarkdownView(source: answer,
                        onReference: turn.status == "completed" ? { onReference("assistant") } : nil,
                        onLike: { onLike("assistant") }, liked: isLiked("assistant"),
                        onReact: turn.status == "completed" ? { onReact("assistant", $0) } : nil, onSelectMessage: turn.status == "completed" ? { onSelect("assistant") } : nil, onShareMessage: turn.status == "completed" ? { onShare("assistant") } : nil)
                        .accessibilityAction(named: Text("引用消息")) { if turn.status == "completed" { onReference("assistant") } }
                        .accessibilityAction(named: Text(isLiked("assistant") ? "取消点赞" : "点赞")) { onLike("assistant") }
                        .accessibilityIdentifier("chat-assistant-message-" + turn.id)
                        .accessibilityAction(named: Text("多选消息")) { onSelect("assistant") }
                        .accessibilityAction(named: Text("分享消息")) { onShare("assistant") }
                    reactionBadge(role: "assistant")
                    if turn.status == "completed" {
                        ChatFollowUpButtons(items: turn.followUpSuggestions, enabled: followUpsEnabled, onSend: onFollowUp)
                    }
                } else if !responseText.isEmpty { ChatMarkdownView(source: responseText) }
                if responding {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.mini)
                        Text(responseStatus ?? (responseText.isEmpty ? "正在思考…" : "正在回答…"))
                    }.font(.caption).foregroundStyle(Color.primary.opacity(0.64)).accessibilityIdentifier("chat-generating")
                } else if turn.status != "completed" {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(error ?? (turn.status == "cancelled" ? "已停止回答" : "回答未完成"))
                            .font(.caption).foregroundStyle(Color.primary.opacity(0.64)).textSelection(.enabled)
                        if let retry {
                            Button("重试", systemImage: "arrow.clockwise", action: retry)
                                .font(.subheadline).frame(minHeight: 44).accessibilityIdentifier("chat-turn-retry")
                        }
                    }.accessibilityIdentifier("reader-conversation-error")
                }
            }.padding(.vertical, 4)
                .padding(.leading, selecting ? 38 : 0)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .leading) { if selecting, turn.answer != nil, turn.status == "completed" { selectionButton(role: "assistant") } }
                .contextMenu { if let answer = turn.answer, turn.status == "completed" { messageActions(role: "assistant", text: answer) } }
                .id("chat-reply-" + turn.id)
                    .background { if isQuickTarget { GeometryReader { geometry in
                        Color.clear.preference(key: ChatTargetFrameKey.self, value: geometry.frame(in: .named("conversation-scroll")))
                    } } }
        }.accessibilityElement(children: .contain).accessibilityIdentifier("reader-conversation-turn-" + turn.id)
    }
    private func selectionButton(role: String) -> some View {
        Button { onSelect(role) } label: { Image(systemName: isSelected(role) ? "checkmark.circle.fill" : "circle").font(.title3).frame(width: 44, height: 44) }.buttonStyle(.plain).foregroundStyle(Color.leafInk)
            .accessibilityLabel((isSelected(role) ? "取消选择" : "选择") + (role == "user" ? "我的消息" : "松鼠的回答"))
    }
    @ViewBuilder private func reactionBadge(role: String) -> some View {
        if let emoji = reaction(role) {
            Button { onReact(role, emoji) } label: { Text(emoji).font(.subheadline).padding(.horizontal, 10).frame(minHeight: 44).background(Color(uiColor: .systemBackground).opacity(0.7), in: Capsule()) }
                .buttonStyle(.plain).accessibilityLabel("已标记 " + emoji + "，点按取消").accessibilityIdentifier("chat-reaction-" + turn.id + ":" + role)
        }
    }
    @ViewBuilder private func messageActions(role: String, text: String) -> some View {
        Button("引用", systemImage: "arrowshape.turn.up.left") { onReference(role) }.disabled(role == "assistant" && turn.status != "completed")
        Button("复制", systemImage: "doc.on.doc") { UIPasteboard.general.string = text }
        Menu("表情") { ForEach(ReaderCloudTools.reactionChoices, id: \.self) { emoji in Button(emoji) { onReact(role, emoji) } } }
        Button("多选", systemImage: "checkmark.circle") { onSelect(role) }
        Button("分享 / 转发", systemImage: "square.and.arrow.up") { onShare(role) }
    }

}

private struct ChatSavedQuoteView: View {
    let quote: ReaderTurnQuote
    @State private var expanded = false
    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            ForEach(Array(quote.parts.enumerated()), id: \.offset) { _, part in
                VStack(alignment: .leading, spacing: 4) {
                    Text(part.label).font(.caption2).foregroundStyle(Color.primary.opacity(0.64))
                    Text(part.text).font(.subheadline).textSelection(.enabled)
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        } label: {
            Label(quote.parts.map(\.text).joined(separator: "\n"), systemImage: "text.quote")
                .font(.caption).foregroundStyle(Color.primary.opacity(0.64)).lineLimit(2)
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
                Text("回复 " + reference.authorLabel).font(.caption2).foregroundStyle(Color.primary.opacity(0.64))
                if !expanded { Text(reference.text).font(.caption).foregroundStyle(Color.primary.opacity(0.64)).lineLimit(2) }
            }
        }.tint(.secondary).accessibilityIdentifier("chat-saved-message-reference")
    }
}
