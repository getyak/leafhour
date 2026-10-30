import SwiftUI
import LeafhourCore

struct ShelfBookCover: View {
    let title: String
    let author: String
    var compact = false
    var resource: BookCoverResource? = nil
    @State private var artwork: UIImage?
    @State private var loadedKey: String?

    var body: some View {
        ZStack {
            fallback
            if loadedKey == resource?.key, let artwork {
                GeometryReader { geometry in
                    Image(uiImage: artwork).resizable().scaledToFit().frame(width: geometry.size.width, height: geometry.size.height)
                        .background(Color(uiColor: .secondarySystemGroupedBackground)).clipped()
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: compact ? 4 : 6))
        .accessibilityHidden(true)
        .task(id: resource?.key) {
            artwork = nil; loadedKey = nil
            let key = resource?.key
            let image = await resource?.load()
            guard !Task.isCancelled, key == resource?.key else { return }
            artwork = image; loadedKey = key
        }
    }
    private var fallback: some View {
        VStack(alignment: .leading, spacing: compact ? 5 : 12) {
            Capsule().fill(Color.leafInk.opacity(0.55)).frame(width: compact ? 15 : 28, height: 2)
            if compact {
                Image(systemName: "book.closed")
                    .font(.system(size: 22, weight: .light))
                    .frame(maxWidth: .infinity, minHeight: 44)
            } else {
                Text(title)
                    .font(.system(size: 19, weight: .semibold, design: .serif))
                    .lineLimit(5)
                    .minimumScaleFactor(0.8)
            }
            Spacer(minLength: 2)
            if !compact && !author.isEmpty {
                Text(author).font(.caption).lineLimit(2)
            }
        }
        .foregroundStyle(Color.leafInk)
        .padding(compact ? 8 : 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.leafInk.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: compact ? 5 : 9))
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 1).fill(Color.leafInk.opacity(0.12)).frame(width: 3).padding(.leading, compact ? 3 : 5)
        }
        .accessibilityHidden(true)
    }
}

struct ShelfBookAvailability: View {
    let item: LibraryShelfItem
    var body: some View {
        if item.isDownloaded {
            Image(systemName: item.isAdditionalVersion ? "books.vertical.circle.fill" : item.hasCloudUpdate ? "arrow.triangle.2.circlepath.circle.fill" : "checkmark.circle.fill")
                .font(.system(size: 16, weight: .medium))
                .symbolRenderingMode(.palette)
                .foregroundStyle(Color.leafInk, Color(uiColor: .systemBackground))
                .padding(5)
                .background(.regularMaterial, in: Circle())
                .accessibilityHidden(true)
        }
    }
}

struct ShelfBookActivity: View {
    let progress: Double?
    let status: String
    var cancel: (() -> Void)? = nil
    var body: some View {
        HStack(spacing: 10) {
            Group {
                if let progress { ProgressView(value: min(1, max(0, progress))) }
                else { ProgressView().controlSize(.mini) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel("书籍处理进度").accessibilityValue(status)
            .accessibilityIdentifier("library-book-progress")
            if let cancel {
                Button(action: cancel) { Image(systemName: "xmark").font(.caption.weight(.semibold)).frame(width: 44, height: 44).contentShape(Rectangle()) }
                    .buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel("取消下载")
                    .accessibilityIdentifier("library-activity-cancel")
            }
        }
    }
}

private extension LibraryShelfItem {
    var readingAccessibilityLabel: String {
        (isDownloaded ? "阅读，" : "下载并阅读，") + title + (isAdditionalVersion ? "，其他离线版本，个人记录保留" : hasCloudUpdate ? "，已下载，云端有更新" : isDownloaded ? "，已下载可离线阅读" : "")
    }
}

struct LibraryShelfRow: View {
    let item: LibraryShelfItem
    let downloadUnavailable: Bool
    var isActive = false
    var progress: Double? = nil
    var status = ""
    var resource: BookCoverResource? = nil
    var cancel: (() -> Void)? = nil
    let open: () -> Void
    let details: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: open) {
                HStack(spacing: 16) {
                    ShelfBookCover(title: item.title, author: item.author, compact: true, resource: resource)
                        .frame(width: dynamicTypeSize.isAccessibilitySize ? 48 : 58, height: dynamicTypeSize.isAccessibilitySize ? 68 : 84)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.title).font(.headline).foregroundStyle(.primary)
                            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                            .fixedSize(horizontal: false, vertical: true)
                        if !item.author.isEmpty {
                            Text(item.author).font(.subheadline).foregroundStyle(.secondary)
                                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer(minLength: 0)
                    ShelfBookAvailability(item: item)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isActive || (!item.isDownloaded && downloadUnavailable))
            .accessibilityLabel(item.readingAccessibilityLabel).accessibilityValue(item.author)
            .contextMenu { if item.isDownloaded { Button("书籍详情", systemImage: "info.circle", action: details) } }
            .accessibilityAction(named: Text("书籍详情")) { if item.isDownloaded { details() } }
            if isActive { ShelfBookActivity(progress: progress, status: status, cancel: cancel) }
        }
        .padding(.vertical, 8)
    }
}

struct LibraryShelfTile: View {
    let item: LibraryShelfItem
    let downloadUnavailable: Bool
    var isActive = false
    var progress: Double? = nil
    var status = ""
    var resource: BookCoverResource? = nil
    var cancel: (() -> Void)? = nil
    let open: () -> Void
    let details: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            LibraryShelfRow(item: item, downloadUnavailable: downloadUnavailable, isActive: isActive, progress: progress, status: status, resource: resource, cancel: cancel, open: open, details: details)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Button(action: open) {
                    VStack(alignment: .leading, spacing: 8) {
                        ShelfBookCover(title: item.title, author: item.author, resource: resource)
                            .aspectRatio(2.0 / 3, contentMode: .fit)
                            .overlay(alignment: .topTrailing) { ShelfBookAvailability(item: item).padding(7) }
                            .shadow(color: .black.opacity(0.07), radius: 5, x: 0, y: 3)
                        Text(item.title).font(.subheadline.weight(.medium)).foregroundStyle(.primary).lineLimit(2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if !item.author.isEmpty { Text(item.author).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                    }.contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(isActive || (!item.isDownloaded && downloadUnavailable))
                .accessibilityLabel(item.readingAccessibilityLabel).accessibilityValue(item.author)
                .contextMenu { if item.isDownloaded { Button("书籍详情", systemImage: "info.circle", action: details) } }
                .accessibilityAction(named: Text("书籍详情")) { if item.isDownloaded { details() } }
                if isActive { ShelfBookActivity(progress: progress, status: status, cancel: cancel) }
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
    }
}
