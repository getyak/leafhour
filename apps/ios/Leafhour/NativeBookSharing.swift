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
    var contextBefore: String? = nil
    var contextAfter: String? = nil
    var plainText: String { [contextBefore.map { "前文\n" + $0 } ?? "", text, contextAfter.map { "后文\n" + $0 } ?? "", attribution, [title, author].filter { !$0.isEmpty }.joined(separator: " · "), location].filter { !$0.isEmpty }.joined(separator: "\n\n") }
    func selectedOnly(includeCitation: Bool, verifiedPublicURL: URL?) -> NativeShareContent {
        NativeShareContent(title: includeCitation ? title : "", author: includeCitation ? author : "", text: text,
                           attribution: attribution, location: includeCitation ? location : "", url: verifiedPublicURL)
    }
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

enum NativeShareCardStyle: String, CaseIterable, Identifiable {
    case paper, ink, night
    var id: String { rawValue }
    var title: String { switch self { case .paper: "暖纸"; case .ink: "苔墨"; case .night: "夜色" } }
    var background: UIColor { switch self { case .paper: UIColor(red: 0.974, green: 0.965, blue: 0.937, alpha: 1); case .ink: UIColor(red: 0.90, green: 0.94, blue: 0.90, alpha: 1); case .night: UIColor(red: 0.10, green: 0.14, blue: 0.12, alpha: 1) } }
    var foreground: UIColor { self == .night ? UIColor(red: 0.92, green: 0.94, blue: 0.90, alpha: 1) : UIColor(red: 0.13, green: 0.17, blue: 0.14, alpha: 1) }
    var secondary: UIColor { self == .night ? UIColor(red: 0.69, green: 0.76, blue: 0.70, alpha: 1) : UIColor(red: 0.34, green: 0.39, blue: 0.35, alpha: 1) }
    var accent: UIColor { self == .night ? UIColor(red: 0.72, green: 0.82, blue: 0.73, alpha: 1) : UIColor(red: 0.24, green: 0.40, blue: 0.31, alpha: 1) }
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
    static func pages(_ content: NativeShareContent, format: NativeShareCardFormat, style: NativeShareCardStyle = .paper) throws -> [NativeShareCardPage] {
        // Bound bitmap allocation, not the number of pages. Never silently truncate.
        guard [content.text, content.title, content.author, content.location, content.attribution,
               content.contextBefore ?? "", content.contextAfter ?? ""].reduce(0, { $0 + $1.utf16.count }) <= 100_000 else {
            throw LibraryError.invalid("内容较长，请分享完整文字；所选内容已全部保留。")
        }
        let width: CGFloat = 1080, inset: CGFloat = 90, usable = width - inset * 2
        let qrCode = try shareQRCode(content.url)
        let quoteSize: CGFloat = 48
        let paragraph = NSMutableParagraphStyle(); paragraph.lineSpacing = 14; paragraph.paragraphSpacing = 22
        let exportTraits = UITraitCollection(preferredContentSizeCategory: .large)
        func attributed(_ text: String, size: CGFloat, color: UIColor, serif: Bool = false, weight: UIFont.Weight = .regular) -> NSAttributedString {
            let font = serif ? ReaderTypography.font(style: .serif, size: Double(size), traits: exportTraits) : UIFont.systemFont(ofSize: size, weight: weight)
            return NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color, .paragraphStyle: paragraph])
        }
        func height(_ value: NSAttributedString, width: CGFloat = usable) -> CGFloat {
            ceil(value.boundingRect(with: CGSize(width: width, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil).height) + 2
        }
        let quote = attributed(content.text, size: quoteSize, color: style.foreground, serif: true)
        let title = attributed(content.title, size: content.text.isEmpty ? 76 : 38, color: style.foreground, serif: content.text.isEmpty, weight: .medium)
        let attribution = attributed(content.attribution, size: 25, color: style.secondary)
        let before = content.contextBefore.flatMap { $0.isEmpty ? nil : attributed($0, size: 32, color: style.secondary) }
        let after = content.contextAfter.flatMap { $0.isEmpty ? nil : attributed($0, size: 32, color: style.secondary) }
        let citationWidth = usable - (qrCode.map { $0.size.width + 44 } ?? 0)
        let titleHeight = height(title, width: content.text.isEmpty ? usable : citationWidth)
        let attributionY: CGFloat = 166
        let beforeY = attributionY + height(attribution) + 42
        let beforeHeight = before.map { height($0, width: usable - 48) + 48 } ?? 0
        let bodyY = beforeY + beforeHeight + (before == nil ? 12 : 34)
        let bodyHeight = content.text.isEmpty ? max(180, titleHeight) : height(quote)
        let afterY = bodyY + bodyHeight + 38
        let afterHeight = after.map { height($0, width: usable - 48) + 48 } ?? 0
        let contentEnd = afterY + afterHeight
        let footer = [content.author, content.location].filter { !$0.isEmpty }.joined(separator: "\n")
        let citation = attributed(footer, size: 25, color: style.secondary)
        let citationHeight = height(citation, width: citationWidth)
        let footerHeight = max((content.text.isEmpty ? 0 : titleHeight + 24) + citationHeight, (qrCode?.size.height ?? 0) + 50)
        let imageHeight = ceil(max(format.height, contentEnd + 90 + footerHeight + 100))
        // 1080 x 18000 RGBA is ~74 MiB; keep export safe on smaller phones.
        guard imageHeight <= 18_000 else { throw LibraryError.invalid("这段内容超出单张长图的安全尺寸，请分享完整文字；内容没有截断。") }
        let footerY = imageHeight - footerHeight - 100
        let body = CGRect(x: inset, y: bodyY, width: usable, height: bodyHeight)
        let citationBounds = CGRect(x: inset, y: footerY + (content.text.isEmpty ? 0 : titleHeight + 24), width: citationWidth, height: citationHeight)
        let qrBounds = qrCode.map { CGRect(x: width - inset - $0.size.width, y: footerY, width: $0.size.width, height: $0.size.height) }
        let imageFormat = UIGraphicsImageRendererFormat(); imageFormat.scale = 1; imageFormat.opaque = true; imageFormat.preferredRange = .standard
        func draw(_ value: NSAttributedString, x: CGFloat = inset, y: CGFloat, width: CGFloat = usable, measuredHeight: CGFloat? = nil) {
            value.draw(with: CGRect(x: x, y: y, width: width, height: measuredHeight ?? height(value, width: width)), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
        }
        // Context remains explicit in the preview and text export. A soft material makes
        // the selected passage the focal plane; no unselected history is added here.
        func frost(_ value: NSAttributedString, y: CGFloat, h: CGFloat, context: CGContext) {
            let bounds = CGRect(x: inset, y: y, width: usable, height: h)
            let plate = UIGraphicsImageRenderer(size: bounds.size, format: imageFormat).image { _ in
                style.background.setFill(); UIRectFill(CGRect(origin: .zero, size: bounds.size))
                value.draw(with: CGRect(x: 24, y: 24, width: usable - 48, height: h - 48), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
            }
            context.saveGState()
            UIBezierPath(roundedRect: bounds, cornerRadius: 24).addClip()
            if let source = CIImage(image: plate) {
                let softened = source.clampedToExtent().applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: 2.5]).cropped(to: source.extent)
                if let cg = CIContext().createCGImage(softened, from: source.extent) { UIImage(cgImage: cg).draw(in: bounds) }
            }
            context.setBlendMode(.normal)
            context.setFillColor(style.background.withAlphaComponent(0.30).cgColor); context.fill(bounds)
            context.restoreGState()
            style.accent.withAlphaComponent(0.18).setStroke()
            UIBezierPath(roundedRect: bounds, cornerRadius: 24).stroke()
        }
        let image = UIGraphicsImageRenderer(size: CGSize(width: width, height: imageHeight), format: imageFormat).image { renderer in
            let context = renderer.cgContext
            style.background.setFill(); context.fill(CGRect(x: 0, y: 0, width: width, height: imageHeight))
            // A restrained outer rule and asymmetric folio give the three palettes one grid.
            context.setStrokeColor(style.accent.withAlphaComponent(0.25).cgColor); context.setLineWidth(1)
            context.move(to: CGPoint(x: inset, y: 137)); context.addLine(to: CGPoint(x: width - inset, y: 137)); context.strokePath()
            draw(attributed("Leafhour", size: 30, color: style.accent, serif: true), y: 70)
            draw(attributed("READ · KEEP · RETURN", size: 17, color: style.secondary), x: width - inset - 245, y: 82, width: 245)
            draw(attribution, y: attributionY)
            if let before { frost(before, y: beforeY, h: beforeHeight, context: context) }
            if content.text.isEmpty { draw(title, y: bodyY) }
            else { draw(quote, y: bodyY) }
            if let after { frost(after, y: afterY, h: afterHeight, context: context) }
            context.setStrokeColor(style.accent.cgColor); context.setLineWidth(3)
            context.move(to: CGPoint(x: inset, y: footerY - 38)); context.addLine(to: CGPoint(x: inset + 64, y: footerY - 38)); context.strokePath()
            if !content.text.isEmpty { draw(title, y: footerY, width: citationWidth, measuredHeight: titleHeight) }
            draw(citation, y: citationBounds.minY, width: citationWidth, measuredHeight: citationHeight)
            if let qrCode, let qrBounds {
                context.interpolationQuality = .none; qrCode.draw(in: qrBounds)
                draw(attributed(content.url?.path.isEmpty == true || content.url?.path == "/" ? "在 Leafhour 阅读" : "扫码，继续阅读", size: 22, color: style.secondary), x: qrBounds.minX, y: qrBounds.maxY + 18, width: qrBounds.width)
            }
        }
        return [NativeShareCardPage(text: content.text, image: image, quoteFontSize: quoteSize, bodyBounds: body, footerY: footerY, citationBounds: citationBounds, qrCodeBounds: qrBounds)]
    }

    /// Only existing content links are encoded; unknown parameters (including account tokens) are rejected.
    /// https://developer.apple.com/documentation/coreimage/cifilter-swift.class/qrcodegenerator()
    private static func shareQRCode(_ url: URL?) throws -> UIImage? {
        guard let url, url.scheme == "https", url.user == nil, url.password == nil, url.fragment == nil,
              (url == URL(string: "https://leafhour.com") || url == URL(string: "https://leafhour.com/") || (try? NativeBookLink(url)) != nil) else { return nil }
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
        NativeBookSharePanel(initial: content, cloud: cloud, cloudBookID: session.book.cloud?.bookID, passageID: quote?.anchor.passageID, contentVersion: session.book.cloud?.contentVersion, chapterID: quote?.anchor.chapterID, allowsGift: quote == nil, embedded: true, closingBlocked: session.saving || session.saveError != nil)
    }
}

@MainActor struct NativeBookSharePanel: View {
    let initial: NativeShareContent
    let cloud: CloudLibraryClient?
    let cloudBookID: String?
    var passageID: String? = nil
    var contentVersion: String? = nil
    var chapterID: String? = nil
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
    @State private var cardStyle: NativeShareCardStyle = .paper
    @State private var pages: [NativeShareCardPage] = []
    @State private var activity: NativeActivityItems?
    @State private var status: String?
    @State private var rendering = false
    @State private var creating = false
    @State private var includeTranslations = false
    @State private var sharingRights = false
    @State private var gift: BookGift?
    @State private var ownerID: String?
    @State private var scopeReady = false
    @State private var includeCitation = false
    @State private var publicVerified = false
    private var current: NativeShareContent {
        let value = content ?? initial
        return initial.text.isEmpty ? value : value.selectedOnly(includeCitation: includeCitation || publicVerified, verifiedPublicURL: publicVerified ? value.url : nil)
    }
    private var textItems: [Any] { [current.plainText] + (current.url.map { [$0 as Any] } ?? []) }
    private var imageItems: [Any] { pages.map { $0.image as Any } + (current.url.map { [$0 as Any] } ?? []) }
    @ViewBuilder var body: some View {
        if embedded { shareContent }
        else { NavigationStack { shareContent } }
    }
    private var shareContent: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("卡片风格").font(.subheadline.weight(.medium))
                        HStack(spacing: 10) {
                            ForEach(NativeShareCardStyle.allCases) { style in
                                Button { cardStyle = style } label: {
                                    VStack(spacing: 7) {
                                        Text("Aa").font(.system(.title3, design: .serif))
                                        HStack(spacing: 4) { Text(style.title).font(.subheadline); if cardStyle == style { Image(systemName: "checkmark").font(.caption) } }
                                    }.foregroundStyle(Color(uiColor: style.foreground))
                                        .frame(maxWidth: .infinity, minHeight: 76).padding(.vertical, 6)
                                        .background(Color(uiColor: style.background), in: RoundedRectangle(cornerRadius: 14))
                                        .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(cardStyle == style ? Color.leafInk : Color.primary.opacity(0.12), lineWidth: cardStyle == style ? 2 : 1) }
                                }.buttonStyle(.plain).accessibilityLabel(style.title)
                                    .accessibilityIdentifier("share-style-" + style.rawValue).accessibilityAddTraits(cardStyle == style ? .isSelected : [])
                            }
                        }
                    }
                    if rendering { ProgressView("正在排版…").frame(maxWidth: .infinity, minHeight: 180) }
                    else if !pages.isEmpty {
                        Image(uiImage: pages[0].image).resizable().scaledToFit()
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .shadow(color: .black.opacity(0.10), radius: 12, y: 4)
                            .accessibilityLabel("完整分享长图")
                    }
                    if !initial.text.isEmpty && !publicVerified {
                        Toggle("附上书名与作者", isOn: $includeCitation).onChange(of: includeCitation) { _, _ in render() }
                        Text("默认只分享所选文字；私人书籍不会生成公开试读链接。").font(.footnote).foregroundStyle(.secondary)
                    }
                    if publicVerified, let url = current.url {
                        Link(destination: url) { Label("从这里试读公版原文", systemImage: "arrow.up.right") }.frame(minHeight: 44)
                        Text("无需登录。二维码与链接只定位公版原文，不含你的笔记或译文。").font(.footnote).foregroundStyle(.secondary)
                    }
                    DisclosureGroup("查看完整文字与出处") {
                        Text(current.plainText).font(.subheadline).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(.top, 10)
                    }
                    VStack(spacing: 12) {
                        HStack {
                            Button { Task { await presentShare(images: false) } } label: { Label("分享文字", systemImage: "text.quote").frame(minHeight: 44) }.accessibilityIdentifier("book-share-text")
                            Spacer()
                        }
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
                .safeAreaInset(edge: .bottom) {
                    Button { Task { await presentShare(images: true) } } label: {
                        Label("分享长图", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity, minHeight: 48)
                    }.buttonStyle(.borderedProminent).disabled(pages.isEmpty || rendering || cloud != nil && !scopeReady)
                        .accessibilityIdentifier("book-share-image").padding(.horizontal, 22).padding(.vertical, 10).background(.bar)
                }
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
                .task(id: format.rawValue + cardStyle.rawValue) { render() }
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
                Text("赠书二维码已创建").font(.headline)
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
        do { pages = try NativeShareCardRenderer.pages(current, format: format, style: cardStyle) }
        catch { pages = []; status = error.localizedDescription }
    }
    private func presentShare(images: Bool) async {
        guard cloud == nil || scopeReady else { return }
        if let cloud, await cloud.activeAccount()?.id != ownerID {
            pages = []; content = nil; status = "账号已切换，请回到自己的书房重新选择。"; return
        }
        activity = NativeActivityItems(values: images ? imageItems : textItems)
    }
    private func loadPublicLink() async {
        guard let cloud else { scopeReady = true; return }
        defer { scopeReady = true }
        let account = await cloud.activeAccount()?.id
        ownerID = account
        guard let id = cloudBookID else { return }
        if let passageID, let contentVersion {
            do {
                let verified = try await cloud.publicReadingExcerpt(bookID: id, passageID: passageID, contentVersion: contentVersion, chapterID: chapterID)
                guard !Task.isCancelled, await cloud.activeAccount()?.id == account else { return }
                var next = initial; next.url = verified.url; content = next; publicVerified = true; render()
            } catch { /* Only a local selected-text card remains; no private fallback link. */ }
            return
        }
        guard let owner = account else { return }
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
            status = "赠书二维码已放入卡片，可预览并分享长图。"; render()
        } catch { status = error.localizedDescription }
    }
    private func revoke(_ published: BookGift) async {
        guard let cloud, let owner = ownerID, !creating else { return }
        creating = true; defer { creating = false }
        do { try await cloud.revokeBookGift(token: published.token, ownerID: owner); gift = nil; var next = current; next.url = nil; content = next; status = "赠书链接已收回。"; render() }
        catch { status = error.localizedDescription }
    }
}
