import SwiftUI
import LeafhourCore

extension BookmarkColor {
    var swiftUIColor: Color {
        let value = UInt32(hex.dropFirst(), radix: 16) ?? 0x35745A
        return Color(.sRGB, red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255, opacity: 1)
    }
}

struct ReaderBookmarkPanel: View {
    let session: ReaderSession
    let onJump: () -> Void
    let currentCapture: ReaderBookmarkCapture?
    @Environment(\.dismiss) private var dismiss
    @State private var editingID: UUID?
    @State private var saving = false
    @State private var feedback: String?
    @State private var draftName = ""

    init(session: ReaderSession, initialBookmarkID: UUID? = nil, currentCapture: ReaderBookmarkCapture? = nil, onJump: @escaping () -> Void = {}) {
        self.session = session; self.onJump = onJump; self.currentCapture = currentCapture
        _editingID = State(initialValue: initialBookmarkID ?? currentCapture.flatMap { session.bookmark(capture: $0)?.id })
    }
    var body: some View {
        Form {
            if let id = editingID, let bookmark = session.bookmarks.first(where: { $0.id == id }) {
                ReaderBookmarkEditor(session: session, bookmark: bookmark, name: $draftName, saving: $saving, onRemove: { editingID = nil })
                    .id(bookmark.id)
            } else {
                Section("当前位置") {
                    Button {
                        guard !saving else { return }
                        saving = true
                        Task {
                            let result: BookmarkSaveResult
                            if let currentCapture { result = await session.addBookmark(capture: currentCapture) }
                            else { result = .unavailable("当前位置尚未核验，请返回书页稳定后重试。") }
                            feedback = result.message; saving = false
                            if result.succeeded, let currentCapture { editingID = session.bookmark(capture: currentCapture)?.id }
                        }
                    } label: { Label(saving ? "正在保存书签…" : "添加当前位置书签", systemImage: "bookmark.badge.plus").frame(minHeight: 44) }
                        .disabled(saving).accessibilityIdentifier("reader-bookmark-add")
                }
            }
            if let feedback { Section { Text(feedback).font(.footnote).accessibilityIdentifier("reader-bookmark-feedback") } }
            Section {
                if session.bookmarks.isEmpty {
                    Text("还没有书签。阅读时下拉并松手，或点击上方按钮，保存当前位置。")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(sortedBookmarks) { bookmark in
                        HStack(spacing: 12) {
                            Button {
                                afterSavingDraft {
                                    if session.goToBookmark(id: bookmark.id) { onJump(); dismiss() }
                                    else { feedback = session.message ?? "原文版本已变化，书签仍保留。" }
                                }
                            } label: {
                                HStack(alignment: .top, spacing: 10) {
                                    Image(systemName: "bookmark.fill").foregroundStyle(bookmark.color.swiftUIColor)
                                        .overlay { Image(systemName: "bookmark").foregroundStyle(.primary.opacity(0.45)) }.accessibilityHidden(true)
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(bookmark.name ?? chapterTitle(bookmark)).foregroundStyle(.primary)
                                        Text(bookmark.matchesVersion(of: session.book) ? excerpt(bookmark) : "原文版本已变化")
                                            .font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                                        Text(bookmark.color.name + (bookmark.presentation.map { " · " + $0.targetLanguage.title + "译文" } ?? ""))
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                }.frame(minHeight: 44).contentShape(Rectangle())
                            }.buttonStyle(.borderless).accessibilityIdentifier("reader-bookmark-jump-" + bookmark.id.uuidString)
                            Button { afterSavingDraft { editingID = bookmark.id; feedback = nil } } label: {
                                Image(systemName: "slider.horizontal.3").frame(width: 44, height: 44).contentShape(Rectangle())
                            }.buttonStyle(.borderless).accessibilityLabel("配置书签，" + (bookmark.name ?? chapterTitle(bookmark)))
                                .accessibilityIdentifier("reader-bookmark-edit-" + bookmark.id.uuidString)
                        }
                    }
                }
            } header: { Text("本书书签 · \(session.bookmarks.count)") }
            footer: { Text("书签保存在此设备，随本机记录一起导出。它们与私人笔记分开，不会自动同步到云端。") }
        }
        .navigationTitle("书签")
        .onChange(of: editingID, initial: true) { _, id in draftName = session.bookmarks.first { $0.id == id }?.name ?? "" }
        .toolbar { ToolbarItem(placement: .confirmationAction) {
            Button { afterSavingDraft { dismiss() }
            } label: { Text("完成").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle()) }
                .disabled(saving).accessibilityIdentifier("reader-bookmark-done")
        } }
        .interactiveDismissDisabled(saving || session.bookmarks.first { $0.id == editingID }.map { draftName != ($0.name ?? "") } == true)
    }
    private func afterSavingDraft(_ action: @escaping () -> Void) {
        guard !saving else { return }
        guard let bookmark = session.bookmarks.first(where: { $0.id == editingID }),
              draftName != (bookmark.name ?? "") || !session.isBookmarkPersisted(id: bookmark.id) else { action(); return }
        saving = true
        Task {
            let result = await session.updateBookmark(id: bookmark.id, color: bookmark.color, name: draftName)
            saving = false
            if result.succeeded { action() } else { feedback = result.message }
        }
    }
    private var sortedBookmarks: [ReaderBookmark] {
        let chapters = Dictionary(uniqueKeysWithValues: session.book.chapters.enumerated().map { ($0.element.id, $0.offset) })
        let passages = Dictionary(uniqueKeysWithValues: session.book.chapters.flatMap { chapter in
            chapter.passages.enumerated().map { (chapter.id + "\n" + $0.element.id, $0.offset) }
        })
        return session.bookmarks.sorted {
            let a = chapters[$0.anchor.chapterID] ?? Int.max, b = chapters[$1.anchor.chapterID] ?? Int.max
            if a != b { return a < b }
            let p = passages[$0.anchor.chapterID + "\n" + $0.anchor.passageID] ?? Int.max
            let q = passages[$1.anchor.chapterID + "\n" + $1.anchor.passageID] ?? Int.max
            if p != q { return p < q }
            if let first = $0.anchor.pageY, let second = $1.anchor.pageY, first != second { return first > second }
            if let first = $0.anchor.resourceY, let second = $1.anchor.resourceY, first != second { return first < second }
            if $0.anchor.characterOffset != $1.anchor.characterOffset { return $0.anchor.characterOffset < $1.anchor.characterOffset }
            if $0.createdAt != $1.createdAt { return $0.createdAt < $1.createdAt }
            return $0.id.uuidString < $1.id.uuidString
        }
    }
    private func chapterTitle(_ bookmark: ReaderBookmark) -> String {
        session.book.chapters.first { $0.id == bookmark.anchor.chapterID }?.title ?? "保存的位置"
    }
    private func excerpt(_ bookmark: ReaderBookmark) -> String {
        if let presentation = bookmark.presentation {
            guard let text = session.verifiedBookmarkText(anchor: bookmark.anchor, presentation: presentation) else { return "译文已变化或尚未就绪 · 待核对" }
            let source = text as NSString
            let offset = min(presentation.utf16Offset, source.length)
            let start = offset < source.length ? source.rangeOfComposedCharacterSequence(at: offset).location : offset
            return String(source.substring(from: start).prefix(90)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        guard let chapter = session.book.chapters.first(where: { $0.id == bookmark.anchor.chapterID }),
              let passage = chapter.passages.first(where: { $0.id == bookmark.anchor.passageID }) else { return "保存的位置" }
        if passage.resourcePath != nil { return chapter.title + " · 插图" }
        let scalars = passage.text.unicodeScalars
        let offset = min(max(0, bookmark.anchor.characterOffset), scalars.count)
        let slice = scalars.dropFirst(offset).prefix(90)
        let text = String(String.UnicodeScalarView(slice)).trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? chapter.title : text
    }
}

struct ReaderBookmarkFeedbackView: View {
    let pull: ReaderBookmarkPullVisual
    let message: String?
    let canEdit: Bool
    let onEdit: () -> Void
    var body: some View {
        HStack(spacing: 8) {
            ZStack {
                Circle().stroke(Color.leafInk.opacity(0.15), lineWidth: 2)
                Circle().trim(from: 0, to: message == nil ? pull.progress : 1)
                    .stroke(Color.leafInk, style: StrokeStyle(lineWidth: 2, lineCap: .round)).rotationEffect(.degrees(-90))
                Image(systemName: message == nil ? (pull.feedback == .armed ? "bookmark.fill" : "arrow.down") : (canEdit ? "checkmark" : "exclamationmark"))
                    .font(.system(size: 10, weight: .semibold))
            }.frame(width: 24, height: 24).accessibilityHidden(true)
            Text(message ?? (pull.feedback == .armed ? "松开添加书签" : "下拉添加书签"))
                .font(.caption).fixedSize(horizontal: false, vertical: true)
            if message != nil, canEdit {
                Button("配置", action: onEdit).font(.caption.weight(.semibold))
                    .frame(minWidth: 44, minHeight: 44).accessibilityIdentifier("reader-bookmark-quick-edit")
            }
        }
        .foregroundStyle(Color.leafInk).padding(.horizontal, 12).padding(.vertical, message == nil ? 8 : 0)
        .background(.regularMaterial, in: Capsule())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("reader-bookmark-feedback")
        .allowsHitTesting(message != nil && canEdit)
    }
}

private struct ReaderBookmarkEditor: View {
    let session: ReaderSession
    let bookmark: ReaderBookmark
    @Binding var name: String
    @Binding var saving: Bool
    let onRemove: () -> Void
    @State private var customHex = ""
    @State private var customColor = Color.green
    @State private var feedback: String?
    @Environment(\.dynamicTypeSize) private var typeSize
    var body: some View {
        Group {
            Section {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: typeSize.isAccessibilitySize ? 2 : 5), spacing: 8) {
                    ForEach(BookmarkColor.presets, id: \.hex) { color in
                        Button { save(color: color) } label: {
                            VStack(spacing: 6) {
                                Circle().fill(color.swiftUIColor).frame(width: 24, height: 24)
                                    .overlay { Circle().stroke(.primary.opacity(0.4), lineWidth: 1) }
                                    .overlay { if bookmark.color == color { Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundStyle(.white) } }
                                Text(color.name).font(.caption).foregroundStyle(.primary)
                            }.padding(.vertical, 4).frame(maxWidth: .infinity, minHeight: 48)
                                .background(bookmark.color == color ? Color.leafInk.opacity(0.08) : Color.clear, in: RoundedRectangle(cornerRadius: 10))
                                .contentShape(Rectangle())
                        }.buttonStyle(.plain).disabled(saving).accessibilityLabel(color.name)
                            .accessibilityValue(bookmark.color == color ? "已选择" : "未选择")
                            .accessibilityAddTraits(bookmark.color == color ? .isSelected : [])
                            .accessibilityIdentifier("reader-bookmark-color-" + String(color.hex.dropFirst()))
                    }
                }
                TextField("名称（可选）", text: $name).submitLabel(.done)
                    .onSubmit { save(color: bookmark.color) }.disabled(saving).accessibilityIdentifier("reader-bookmark-name")
            } header: { Text("此处标记") }
            footer: { Text("颜色点选即存，名称按“完成”保存。") }
            Section {
                DisclosureGroup("自定义颜色") {
                    ColorPicker("选择颜色", selection: $customColor, supportsOpacity: false).frame(minHeight: 44)
                    .onChange(of: customColor) { _, color in
                        let rgb = UIColor(color).cgColor.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil)?.components
                        if let rgb, rgb.count >= 3 { customHex = String(format: "#%02X%02X%02X", Int((rgb[0] * 255).rounded()), Int((rgb[1] * 255).rounded()), Int((rgb[2] * 255).rounded())) }
                    }.accessibilityIdentifier("reader-bookmark-custom-color")
                    TextField("例如 #35745A", text: $customHex).textInputAutocapitalization(.characters).autocorrectionDisabled()
                        .accessibilityLabel("自定义颜色代码，六位十六进制").accessibilityIdentifier("reader-bookmark-custom-hex")
                Button("保存自定义颜色") {
                    guard let color = BookmarkColor(hex: customHex.trimmingCharacters(in: .whitespacesAndNewlines)) else { feedback = "请输入有效颜色，或重新选择。"; return }
                    save(color: color)
                }.frame(minHeight: 44).disabled(saving)
                }
                if let feedback { Text(feedback).font(.footnote).accessibilityIdentifier("reader-bookmark-editor-feedback") }
            }
            Section {
                Button("移除书签", role: .destructive) {
                    guard !saving else { return }; saving = true
                    Task {
                        let result = await session.removeBookmark(id: bookmark.id); saving = false; feedback = result.message
                        if result.succeeded { onRemove() }
                    }
                }.frame(minHeight: 44).disabled(saving).accessibilityIdentifier("reader-bookmark-remove")
            }
        }
        .onAppear { customHex = bookmark.color.hex; customColor = bookmark.color.swiftUIColor }
        .onChange(of: bookmark.color) { _, color in customHex = color.hex; customColor = color.swiftUIColor }
    }
    private func save(color: BookmarkColor) {
        guard !saving else { return }; saving = true
        Task {
            let result = await session.updateBookmark(id: bookmark.id, color: color, name: name)
            saving = false; feedback = result.message
        }
    }
}
