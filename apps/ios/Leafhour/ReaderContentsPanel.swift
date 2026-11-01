import SwiftUI
import LeafhourCore

struct ReaderContentsPanel: View {
    @Bindable var session: ReaderSession
    let onJump: (Int, ReadingAnchor?) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var query = ""
    @State private var searchPresented = false
    @State private var locationRequest = 0
    @State private var readingStart: ReadingAnchor?

    private var isPDF: Bool { session.book.kind == .pdf }
    private var entries: [ReaderContentsEntry] {
        ReaderContentsIndex.entries(chapters: session.book.chapters, kind: session.book.kind, query: query)
    }
    private var unit: String { isPDF ? "页" : "章" }
    private var currentLabel: String { isPDF ? "当前页" : "当前章节" }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                Section("正在读") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(session.chapter.title).font(.subheadline.weight(.medium))
                            .fixedSize(horizontal: false, vertical: true)
                        Text("第 \(session.chapterIndex + 1) \(unit) · 共 \(session.book.chapters.count) \(unit)")
                            .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    }.padding(.vertical, 4)
                    if let readingStart,
                       let index = session.book.chapters.firstIndex(where: { $0.id == readingStart.chapterID }) {
                        Button { onJump(index, readingStart) } label: {
                            Label("从正文开始", systemImage: "book.pages").frame(minHeight: 44)
                        }.accessibilityIdentifier("reader-start-body")
                    }
                }
                Section(listTitle) {
                    if entries.isEmpty {
                        ContentUnavailableView.search(text: query)
                            .listRowSeparator(.hidden)
                    } else {
                        ForEach(entries) { entry in
                            Button { onJump(entry.chapterIndex, nil) } label: {
                                contentsRowLayout {
                                    Text(entry.title).font(.subheadline).foregroundStyle(.primary)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .fixedSize(horizontal: false, vertical: true)
                                    if entry.chapterIndex == session.chapterIndex {
                                        Image(systemName: "bookmark.fill")
                                            .font(.caption).foregroundStyle(Color.leafInk)
                                            .fixedSize().accessibilityHidden(true)
                                    }
                                }.frame(minHeight: 44).contentShape(Rectangle())
                            }
                            .accessibilityLabel(entry.title)
                            .accessibilityValue(entry.chapterIndex == session.chapterIndex ? "\(currentLabel)，第 \(entry.chapterIndex + 1) \(unit)" : "第 \(entry.chapterIndex + 1) \(unit)")
                            .accessibilityIdentifier("reader-contents-entry-\(entry.chapterIndex)")
                            .listRowBackground(entry.chapterIndex == session.chapterIndex ? Color.leafInk.opacity(0.08) : Color.clear)
                            .listRowInsets(EdgeInsets(top: 4, leading: 18, bottom: 4, trailing: 18))
                            .id(entry.id)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        query = ""; searchPresented = false; locationRequest += 1
                    } label: {
                        Image(systemName: "scope").frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("定位\(currentLabel)")
                    .accessibilityHint("清除目录搜索，滚动到正在阅读的位置，不改变书页")
                    .accessibilityIdentifier("reader-contents-locate-current")
                }
            }
            .task(id: locationRequest) {
                await Task.yield()
                guard !Task.isCancelled else { return }
                withAnimation(locationRequest == 0 || reduceMotion ? nil : .easeOut(duration: 0.18)) {
                    proxy.scrollTo(session.chapter.id, anchor: .center)
                }
            }
        }
        .searchable(text: $query, isPresented: $searchPresented,
                    placement: .navigationBarDrawer(displayMode: .automatic),
                    prompt: Text(isPDF ? "输入页码或页面标题" : "搜索章节标题"))
        .navigationTitle("目录")
        .task(id: session.book.id) { readingStart = session.declaredReadingStart() }
    }

    private var listTitle: String {
        if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return isPDF ? "全部页面" : "全部章节" }
        return "找到 \(entries.count) \(unit)"
    }
    private var contentsRowLayout: AnyLayout {
        if dynamicTypeSize.isAccessibilitySize { return AnyLayout(VStackLayout(alignment: .leading, spacing: 6)) }
        return AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
    }
}

/// Own the dismissing tap so it can never reach the page-turn gesture below.
struct ReaderContentsOverlay: View {
    @Bindable var session: ReaderSession
    let onJump: (Int, ReadingAnchor?) -> Void
    let onClose: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Color.black.opacity(0.22).ignoresSafeArea()
                    .contentShape(Rectangle()).onTapGesture(perform: onClose)
                    .accessibilityLabel("收起目录").accessibilityAddTraits(.isButton)
                    .accessibilityIdentifier("reader-contents-backdrop")
                NavigationStack {
                    ReaderContentsPanel(session: session, onJump: onJump)
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar(.visible, for: .navigationBar)
                        .toolbar {
                            ToolbarItem(placement: .topBarLeading) {
                                Button("收起目录", systemImage: "xmark") { onClose() }
                                    .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                                    .accessibilityIdentifier("reader-contents-close")
                            }
                        }
                }
                .frame(width: min(geometry.size.width - 48, typeSize.isAccessibilitySize ? 430 : 340))
                .background(Color(uiColor: .systemBackground))
                .shadow(color: .black.opacity(0.1), radius: 12, x: 4)
                .accessibilityAction(.escape, onClose)
                .simultaneousGesture(DragGesture(minimumDistance: 24).onEnded { value in
                    if value.translation.width < -64 && abs(value.translation.height) < abs(value.translation.width) { onClose() }
                })
                .transition(.move(edge: .leading))
            }.animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: session.chapterIndex)
        }
    }
}
