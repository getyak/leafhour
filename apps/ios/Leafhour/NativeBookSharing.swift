import SwiftUI
import UIKit
import CoreImage.CIFilterBuiltins
import LeafhourCore

@MainActor @Observable final class ShelfShareFilePreparation {
    private(set) var files: [URL] = []
    private(set) var error: String?
    private(set) var preparing = false
    private var cached: [String: URL] = [:]
    private var scope: UUID?
    var preparedCount: Int { cached.count }
    var notice: String? { preparing ? "正在准备书籍文件…" : error }
    func fail(_ message: String) { error = message }
    func prepare(ids: [String], scope: UUID, currentScope: () -> UUID, export: (String, Int) async throws -> URL) async {
        guard !preparing else { return }
        if self.scope != scope { cached = [:]; files = []; self.scope = scope }
        preparing = true; error = nil
        defer { preparing = false }
        do {
            for (index, id) in ids.enumerated() {
                try Task.checkCancellation()
                guard currentScope() == scope else { throw LibraryError.invalid("账号已切换，请在自己的书房重新准备文件。") }
                if let ready = cached[id], FileManager.default.fileExists(atPath: ready.path) { continue }
                let file = try await export(id, index)
                try Task.checkCancellation()
                guard currentScope() == scope else { throw LibraryError.invalid("账号已切换，请在自己的书房重新准备文件。") }
                cached[id] = file
            }
            files = ids.compactMap { cached[$0] }
        } catch is CancellationError { }
        catch { self.error = error.localizedDescription }
        if currentScope() != scope { files = []; cached = [:] }
    }
}

struct NativeShareContent {
    let title: String
    let author: String
    let text: String
    let attribution: String
    let location: String
    var url: URL?
    var plainText: String { [text, attribution, [title, author].filter { !$0.isEmpty }.joined(separator: " · "), location, url?.absoluteString ?? ""].filter { !$0.isEmpty }.joined(separator: "\n\n") }
    static func attribution(quote: SelectedQuote, cached: ReadingTranslation?) -> String {
        guard quote.origin == "translation" else { return "作者原文" }
        guard let variant = quote.variant, ["literal", "interpretive"].contains(variant) else { return "译文 · 未核对" }
        let label = variant == "literal" ? "直译" : "意译"
        guard let cached, let source = quote.sourceText, cached.original == source,
              let offset = quote.translationOffset, offset >= 0,
              let text = variant == "literal" ? cached.literal : cached.interpretive else { return label + " · 未核对" }
        let current = text as NSString, length = (quote.text as NSString).length
        guard offset <= current.length, length <= current.length - offset,
              current.substring(with: NSRange(location: offset, length: length)) == quote.text else { return label + " · 未核对" }
        let status = variant == "literal" ? cached.literalStatus : cached.interpretiveStatus
        return label + (status == "reviewed" ? "" : status == "draft" ? " · 草稿" : " · 未核对")
    }
}

enum NativeShareCardFormat: String, CaseIterable, Identifiable {
    case portrait, square, story
    var id: String { rawValue }
    var label: String { switch self { case .portrait: "竖卡"; case .square: "方形"; case .story: "全屏" } }
    var height: CGFloat { switch self { case .portrait: 1350; case .square: 1080; case .story: 1920 } }
}

struct NativeShareCardPage {
    let text: String
    let image: UIImage
    let quoteFontSize: CGFloat
    let bodyBounds: CGRect
    let footerY: CGFloat
    let citationBounds: CGRect
    let qrCodeBounds: CGRect?
}

/// Actual UIKit text measurement and drawing use the same attributed strings.
/// https://developer.apple.com/documentation/uikit/uigraphicsimagerenderer
@MainActor enum NativeShareCardRenderer {
    static func pages(_ content: NativeShareContent, format: NativeShareCardFormat) throws -> [NativeShareCardPage] {
        guard content.text.utf16.count <= 100_000 else { throw LibraryError.invalid("摘录较长，请使用完整文字分享；所选内容已全部保留。") }
        let width: CGFloat = 1080, inset: CGFloat = 90, usable = width - inset * 2
        let qrCode = try shareQRCode(content.url)
        let citationWidth = usable - (qrCode.map { $0.size.width + 36 } ?? 0)
        let footerURL = qrCode.flatMap { _ in content.url?.absoluteString }
        let footer = (content.text.isEmpty ? [content.author, footerURL ?? "Leafhour"] : [content.author, content.location, footerURL ?? ""]).filter { !$0.isEmpty }.joined(separator: "\n")
        let citationParagraph = NSMutableParagraphStyle(); citationParagraph.lineSpacing = 5; citationParagraph.lineBreakMode = .byCharWrapping
        let citation = NSAttributedString(string: footer, attributes: [.font: UIFont.systemFont(ofSize: 23), .foregroundColor: UIColor(red: 0.34, green: 0.39, blue: 0.35, alpha: 1), .paragraphStyle: citationParagraph])
        let citationHeight = citation.boundingRect(with: CGSize(width: citationWidth, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil).height.rounded(.up)
        let footerY = format.height - 180 - max(0, max(citationHeight, qrCode?.size.height ?? 0) - 32), bodyY: CGFloat = 210
        let qrBounds = qrCode.map { CGRect(x: width - inset - $0.size.width, y: footerY + 84, width: $0.size.width, height: $0.size.height) }
        let body = CGRect(x: inset, y: bodyY, width: usable, height: footerY - bodyY - 55)
        guard body.height >= 160 else { throw LibraryError.invalid("出处信息较长，请使用竖卡、全屏卡片或完整文字分享。") }
        let quoteSize: CGFloat = 48
        let paragraph = NSMutableParagraphStyle(); paragraph.lineSpacing = 14; paragraph.paragraphSpacing = 18
        let descriptor = UIFont.systemFont(ofSize: quoteSize).fontDescriptor.withDesign(.serif) ?? UIFont.systemFont(ofSize: quoteSize).fontDescriptor
        let attributes: [NSAttributedString.Key: Any] = [.font: UIFont(descriptor: descriptor, size: quoteSize), .foregroundColor: UIColor(red: 0.13, green: 0.17, blue: 0.14, alpha: 1), .paragraphStyle: paragraph]
        func height(_ text: String) -> CGFloat { NSAttributedString(string: text, attributes: attributes).boundingRect(with: CGSize(width: usable, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil).height.rounded(.up) }
        var chunks: [String] = []
        let characters = Array(content.text)
        var start = 0
        while start < characters.count {
            guard chunks.count < 12 else { throw LibraryError.invalid("摘录超过 12 张卡片，请使用完整文字分享；所选内容已全部保留。") }
            var low = start + 1, high = min(characters.count, start + 1600), end = start
            while low <= high {
                let middle = (low + high) / 2
                if height(String(characters[start..<middle])) <= body.height { end = middle; low = middle + 1 } else { high = middle - 1 }
            }
            guard end > start else { throw LibraryError.invalid("这段文字暂时无法排版，请使用完整文字分享。") }
            // Prefer a word boundary without discarding even a single space.
            if end < characters.count, end - start > 20,
               let boundary = (max(start + 1, end - 80)..<end).reversed().first(where: { characters[$0].isWhitespace }) { end = boundary + 1 }
            chunks.append(String(characters[start..<end])); start = end
        }
        if chunks.isEmpty { chunks = [""] }
        let ink = UIColor(red: 0.13, green: 0.17, blue: 0.14, alpha: 1), green = UIColor(red: 0.24, green: 0.40, blue: 0.31, alpha: 1)
        let muted = UIColor(red: 0.34, green: 0.39, blue: 0.35, alpha: 1)
        let imageFormat = UIGraphicsImageRendererFormat(); imageFormat.scale = 1; imageFormat.opaque = true
        return try chunks.enumerated().map { index, text in
            var titleSize: CGFloat = content.text.isEmpty ? 76 : 38
            func titleString() -> NSAttributedString { NSAttributedString(string: content.title, attributes: [.font: UIFont.systemFont(ofSize: titleSize, weight: .medium), .foregroundColor: ink]) }
            let titleHeightLimit: CGFloat = content.text.isEmpty ? body.height - 150 : 76
            while titleString().boundingRect(with: CGSize(width: usable, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil).height > titleHeightLimit, titleSize > 28 { titleSize -= 2 }
            guard titleString().boundingRect(with: CGSize(width: usable, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil).height <= titleHeightLimit else { throw LibraryError.invalid("书名较长，请使用完整文字分享。") }
            let image = UIGraphicsImageRenderer(size: CGSize(width: width, height: format.height), format: imageFormat).image { renderer in
                let context = renderer.cgContext
                UIColor(red: 0.974, green: 0.965, blue: 0.937, alpha: 1).setFill(); context.fill(CGRect(x: 0, y: 0, width: width, height: format.height))
                func line(_ value: String, y: CGFloat, size: CGFloat, color: UIColor = muted) {
                    NSAttributedString(string: value, attributes: [.font: UIFont.systemFont(ofSize: size), .foregroundColor: color]).draw(in: CGRect(x: inset, y: y, width: usable, height: size * 2.6))
                }
                line("Leafhour", y: 74, size: 30, color: green)
                context.setStrokeColor(green.withAlphaComponent(0.35).cgColor); context.setLineWidth(1); context.move(to: CGPoint(x: inset, y: 137)); context.addLine(to: CGPoint(x: width - inset, y: 137)); context.strokePath()
                if content.text.isEmpty {
                    let measured = titleString().boundingRect(with: CGSize(width: usable, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
                    let y = body.midY - measured.height / 2 - 30
                    titleString().draw(in: CGRect(x: inset, y: y, width: usable, height: measured.height + 2))
                } else {
                    line(content.attribution, y: 159, size: 25)
                    NSAttributedString(string: text, attributes: attributes).draw(with: body, options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
                }
                context.setStrokeColor(green.withAlphaComponent(0.35).cgColor); context.move(to: CGPoint(x: inset, y: footerY - 30)); context.addLine(to: CGPoint(x: inset + 56, y: footerY - 30)); context.strokePath()
                if !content.text.isEmpty { titleString().draw(in: CGRect(x: inset, y: footerY, width: usable, height: 80)) }
                citation.draw(with: CGRect(x: inset, y: footerY + 84, width: citationWidth, height: citationHeight + 2), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
                if let qrCode, let qrBounds { context.interpolationQuality = .none; qrCode.draw(in: qrBounds) }
                if chunks.count > 1 {
                    let number = NSAttributedString(string: "\(index + 1) / \(chunks.count)", attributes: [.font: UIFont.monospacedDigitSystemFont(ofSize: 23, weight: .regular), .foregroundColor: muted])
                    number.draw(at: CGPoint(x: width - inset - number.size().width, y: 78))
                }
            }
            return NativeShareCardPage(text: text, image: image, quoteFontSize: quoteSize, bodyBounds: body, footerY: footerY,
                citationBounds: CGRect(x: inset, y: footerY + 84, width: citationWidth, height: citationHeight + 2), qrCodeBounds: qrBounds)
        }
    }

    /// Only existing content links are encoded; unknown parameters (including account tokens) are rejected.
    /// https://developer.apple.com/documentation/coreimage/cifilter-swift.class/qrcodegenerator()
    private static func shareQRCode(_ url: URL?) throws -> UIImage? {
        guard let url, url.scheme == "https", (try? NativeBookLink(url, origin: url)) != nil else { return nil }
        let filter = CIFilter.qrCodeGenerator(); filter.message = Data(url.absoluteString.utf8); filter.correctionLevel = "M"
        guard let output = filter.outputImage, let code = CIContext().createCGImage(output, from: output.extent) else {
            throw LibraryError.invalid("二维码暂时无法生成，请使用完整文字或链接分享。")
        }
        // Four white modules per side; integer scaling keeps every exported module sharp.
        let scale = max(1, 216 / (code.width + 8)), quiet = 4 * scale
        let size = CGSize(width: CGFloat((code.width + 8) * scale), height: CGFloat((code.height + 8) * scale))
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true; format.preferredRange = .standard
        return UIGraphicsImageRenderer(size: size, format: format).image { renderer in
            UIColor.white.setFill(); renderer.fill(CGRect(origin: .zero, size: size))
            renderer.cgContext.interpolationQuality = .none
            renderer.cgContext.setShouldAntialias(false)
            UIImage(cgImage: code).draw(in: CGRect(x: CGFloat(quiet), y: CGFloat(quiet), width: CGFloat(code.width * scale), height: CGFloat(code.height * scale)))
        }
    }
}

struct NativeActivityItems: Identifiable {
    let id = UUID()
    let values: [Any]
}

/// Each activity receives one chosen representation. The system lists installed destinations.
/// https://developer.apple.com/documentation/uikit/uiactivityviewcontroller
@MainActor struct NativeActivitySheet: UIViewControllerRepresentable {
    let selection: NativeActivityItems
    let completion: (Bool, Error?) -> Void
    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: selection.values, applicationActivities: nil)
        controller.completionWithItemsHandler = { _, completed, _, error in completion(completed, error) }
        if let popover = controller.popoverPresentationController {
            popover.sourceView = controller.view; popover.sourceRect = CGRect(x: 1, y: 1, width: 1, height: 1); popover.permittedArrowDirections = []
        }
        return controller
    }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) { }
}

@MainActor struct ReaderSharePanel: View {
    let session: ReaderSession
    let quote: SelectedQuote?
    let cloud: CloudLibraryClient?
    private var content: NativeShareContent {
        let chapter = quote.flatMap { selected in session.book.chapters.first { $0.id == selected.anchor.chapterID } }
        let cached = quote.flatMap { session.translations[$0.anchor.passageID] }
        let label = quote.map { NativeShareContent.attribution(quote: $0, cached: cached) } ?? "书籍信息"
        return NativeShareContent(title: session.book.title, author: session.book.author, text: quote?.text ?? "", attribution: quote == nil ? "书籍信息" : label, location: chapter?.title ?? "", url: nil)
    }
    var body: some View {
        NativeBookSharePanel(initial: content, cloud: cloud, cloudBookID: session.book.cloud?.bookID, passageID: quote?.anchor.passageID, allowsGift: quote == nil, embedded: true, closingBlocked: session.saving || session.saveError != nil)
    }
}

@MainActor struct NativeBookSharePanel: View {
    let initial: NativeShareContent
    let cloud: CloudLibraryClient?
    let cloudBookID: String?
    var passageID: String? = nil
    var allowsGift = true
    var files: [URL] = []
    var fileNotice: String? = nil
    var retryFiles: (() -> Void)? = nil
    var embedded = false
    var closingBlocked = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.readerContinueReading) private var readerContinueReading
    @State private var content: NativeShareContent?
    @State private var format: NativeShareCardFormat = .portrait
    @State private var pages: [NativeShareCardPage] = []
    @State private var activity: NativeActivityItems?
    @State private var status: String?
    @State private var rendering = false
    @State private var creating = false
    @State private var includeTranslations = false
    @State private var sharingRights = false
    @State private var gift: BookGift?
    @State private var ownerID: String?
    private var current: NativeShareContent { content ?? initial }
    @ViewBuilder var body: some View {
        if embedded { shareContent }
        else { NavigationStack { shareContent } }
    }
    private var shareContent: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if rendering { ProgressView("正在排版…").frame(maxWidth: .infinity, minHeight: 180) }
                    else if !pages.isEmpty {
                        TabView {
                            ForEach(pages.indices, id: \.self) { index in
                                Image(uiImage: pages[index].image).resizable().scaledToFit().padding(.horizontal, 4)
                                    .accessibilityLabel("分享卡片，第 \(index + 1) 张，共 \(pages.count) 张")
                            }
                        }.tabViewStyle(.page(indexDisplayMode: pages.count > 1 ? .always : .never)).frame(height: 360)
                    }
                    if pages.count > 1 { Text("共 \(pages.count) 张，所选文字完整保留。").font(.footnote).foregroundStyle(.secondary) }
                    DisclosureGroup("将分享的内容") {
                        Text(current.plainText).font(.subheadline).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(.top, 10)
                    }
                    Picker("卡片比例", selection: $format) { ForEach(NativeShareCardFormat.allCases) { Text($0.label).tag($0) } }.pickerStyle(.segmented)
                    VStack(spacing: 12) {
                        Button { activity = NativeActivityItems(values: pages.map(\.image)) } label: { Label("分享图片", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity, minHeight: 44) }
                            .buttonStyle(.borderedProminent).disabled(pages.isEmpty || rendering).accessibilityIdentifier("book-share-image")
                        HStack {
                            Button { activity = NativeActivityItems(values: [current.plainText]) } label: { Label("分享文字", systemImage: "text.quote").frame(minHeight: 44) }.accessibilityIdentifier("book-share-text")
                            Spacer()
                            if let url = current.url {
                                Button { UIPasteboard.general.url = url; status = "链接已复制。" } label: { Label("复制链接", systemImage: "link").frame(minHeight: 44) }.accessibilityIdentifier("book-share-copy-link")
                            }
                        }
                        if let url = current.url { ShareLink(item: url) { Label("分享链接", systemImage: "link").frame(minHeight: 44) } }
                    }
                    Text("卡片与文字只包含上方预览的内容，不包含私人笔记、草稿或阅读记录。系统会显示此设备可用的分享 App。").font(.footnote).foregroundStyle(.secondary)
                    if allowsGift, cloudBookID != nil, cloud != nil {
                        giftControls
                    } else if allowsGift, cloudBookID == nil {
                        Text("此书只在这台设备上，还没有可供他人导入的链接。可分享书籍信息，或在书籍详情中导出文件。").font(.footnote).foregroundStyle(.secondary)
                    }
                    if !files.isEmpty {
                        DisclosureGroup("分享书籍文件") {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("本机书籍按原格式分享；云端正文阅读副本导出整本原文 TXT。不会带上私人笔记、草稿或阅读记录。").font(.footnote).foregroundStyle(.secondary).padding(.top, 10)
                                ShareLink(items: files) { Label("分享这些文件", systemImage: "doc").frame(minHeight: 44) }
                            }
                        }
                    } else if let fileNotice {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(fileNotice).font(.footnote).foregroundStyle(.secondary)
                            if let retryFiles { Button("重试准备文件", action: retryFiles).frame(minHeight: 44).accessibilityIdentifier("book-share-retry-files") }
                        }
                    }
                    if let status { Text(status).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("book-share-status") }
                }.padding(22)
            }.background(Color.shelfPaper)
                .navigationTitle(initial.text.isEmpty ? "分享本书" : "分享摘录").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("完成") {
                            if embedded { readerContinueReading?() }
                            else { dismiss() }
                        }.disabled(creating || embedded && readerContinueReading == nil)
                            .accessibilityIdentifier("book-share-complete")
                    }
                }
                .interactiveDismissDisabled(creating || closingBlocked)
                .task(id: format) { render() }
                .task { await loadPublicLink() }
                .sheet(item: $activity) { selection in
                    NativeActivitySheet(selection: selection) { completed, error in
                        status = error == nil ? (completed ? "已交给所选 App。" : nil) : "分享暂未完成，可重试或分享完整文字。"
                    }
                }
    }
    @ViewBuilder private var giftControls: some View {
        if let gift {
            VStack(alignment: .leading, spacing: 12) {
                Text("赠书链接已创建").font(.headline)
                Text("获得链接的人可以查看和导入这份书籍副本。已导入的副本不受链接收回影响。").font(.footnote).foregroundStyle(.secondary)
                Button("收回赠书链接", role: .destructive) { Task { await revoke(gift) } }.disabled(creating)
            }
        } else {
            DisclosureGroup("创建可导入的赠书链接") {
                VStack(alignment: .leading, spacing: 14) {
                    Text("分享范围：整本书已提取的原文，以及可分享的编辑注解与术语。原始文件、私人笔记、草稿、对话和阅读记录不包含在内。链接可被转发，获得链接的人可以下载和导入这份副本。").font(.subheadline).fixedSize(horizontal: false, vertical: true)
                    Toggle("包含已有译文", isOn: $includeTranslations)
                    Text("不会生成新译文；既有译文保留原来的版本与草稿状态。").font(.footnote).foregroundStyle(.secondary)
                    Toggle("我可以分享这份书籍内容", isOn: $sharingRights)
                    Button { Task { await createGift() } } label: {
                        HStack { Text(creating ? "正在创建赠书链接…" : "按此范围创建链接"); if creating { ProgressView() } }
                    }.buttonStyle(.bordered).disabled(creating || !sharingRights || ownerID == nil).accessibilityIdentifier("book-share-create-gift")
                    if ownerID == nil { Text("连接自己的书房后可创建链接。").font(.footnote).foregroundStyle(.secondary) }
                }.padding(.top, 12).disabled(creating)
            }
        }
    }
    private func render() {
        rendering = true
        defer { rendering = false }
        do { pages = try NativeShareCardRenderer.pages(current, format: format) }
        catch { pages = []; status = error.localizedDescription }
    }
    private func loadPublicLink() async {
        guard let cloud, let id = cloudBookID, let owner = await cloud.activeAccount()?.id else { return }
        ownerID = owner
        do {
            let remote = try await cloud.readableBook(bookID: id, ownerID: owner)
            guard !Task.isCancelled, await cloud.activeAccount()?.id == owner else { return }
            if gift == nil, let url = remote.publicReadingURL(origin: cloud.baseURL, passageID: passageID) {
                var next = initial; next.url = url; content = next; render()
            }
        } catch { /* Offline cards and complete text remain available. */ }
    }
    private func createGift() async {
        guard !creating, sharingRights, let cloud, let id = cloudBookID, let owner = ownerID, await cloud.activeAccount()?.id == owner else { return }
        creating = true; status = nil
        defer { creating = false }
        do {
            let created = try await cloud.createBookGift(bookID: id, ownerID: owner, includeTranslations: includeTranslations)
            guard await cloud.activeAccount()?.id == owner else { return }
            gift = created; var next = current; next.url = created.url(origin: cloud.baseURL); content = next
            status = "链接已创建，可复制链接或通过系统分享。"; render()
        } catch { status = error.localizedDescription }
    }
    private func revoke(_ published: BookGift) async {
        guard let cloud, let owner = ownerID, !creating else { return }
        creating = true; defer { creating = false }
        do { try await cloud.revokeBookGift(token: published.token, ownerID: owner); gift = nil; var next = current; next.url = nil; content = next; status = "赠书链接已收回。"; render() }
        catch { status = error.localizedDescription }
    }
}
