import SwiftUI
import LeafhourCore

/// A typographic fallback, not a downloaded or generated book-cover image.
struct ShelfBookCover: View {
    let title: String
    let author: String
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 5 : 12) {
            Capsule().fill(Color.leafInk.opacity(0.55)).frame(width: compact ? 15 : 28, height: 2)
            Text(title)
                .font(.system(size: compact ? 10 : 19, weight: .semibold, design: .serif))
                .lineLimit(compact ? 4 : 5)
                .minimumScaleFactor(0.8)
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
            Label(item.hasCloudUpdate ? "已下载 · 云端有更新" : "已下载 · 可离线阅读", systemImage: "checkmark.circle")
                .foregroundStyle(Color.leafInk)
        } else {
            Label("尚未下载", systemImage: "icloud")
                .foregroundStyle(.secondary)
        }
    }
}

struct ShelfBookActivity: View {
    let progress: Double?
    let status: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            if let progress {
                ProgressView(value: min(1, max(0, progress)))
                    .accessibilityLabel("书籍处理进度")
            } else {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.mini)
                    Text("正在处理").font(.caption)
                }
            }
            if !status.isEmpty {
                Text(status).font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

struct LibraryShelfRow: View {
    let item: LibraryShelfItem
    let downloadUnavailable: Bool
    var isActive = false
    var progress: Double? = nil
    var status = ""
    let open: () -> Void
    let details: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            if item.isDownloaded {
                Button(action: open) { bookLabel }
                    .buttonStyle(.plain)
                    .accessibilityLabel("阅读，\(item.title)，已下载可离线阅读")
            } else {
                bookLabel
            }
            if item.isDownloaded {
                Button(action: details) {
                    Image(systemName: "info.circle").frame(width: 44, height: 44)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("\(item.title)，书籍详情")
            } else if !isActive {
                Button(action: open) {
                    Image(systemName: "icloud.and.arrow.down").frame(width: 44, height: 44)
                }
                .buttonStyle(.borderless)
                .disabled(downloadUnavailable)
                .accessibilityLabel("下载并阅读，\(item.title)")
            }
        }
        .padding(.vertical, 7)
    }

    private var bookLabel: some View {
        HStack(spacing: 14) {
            ShelfBookCover(title: item.title, author: item.author, compact: true).frame(width: 58, height: 80)
            VStack(alignment: .leading, spacing: 6) {
                Text(item.title).font(.headline).foregroundStyle(.primary).lineLimit(2)
                if !item.author.isEmpty { Text(item.author).font(.subheadline).foregroundStyle(.secondary).lineLimit(1) }
                if isActive { ShelfBookActivity(progress: progress, status: status) }
                else { ShelfBookAvailability(item: item).font(.caption) }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }
}

struct LibraryShelfTile: View {
    let item: LibraryShelfItem
    let downloadUnavailable: Bool
    var isActive = false
    var progress: Double? = nil
    var status = ""
    let open: () -> Void
    let details: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            if item.isDownloaded {
                Button(action: open) { cover }
                    .buttonStyle(.plain)
                    .accessibilityLabel("阅读，\(item.title)，已下载可离线阅读")
            } else {
                cover
            }
            Text(item.title).font(.subheadline.weight(.semibold)).lineLimit(2)
            if !item.author.isEmpty { Text(item.author).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            if isActive {
                ShelfBookActivity(progress: progress, status: status)
            } else {
                ShelfBookAvailability(item: item).font(.caption2)
            }
            HStack {
                if item.isDownloaded {
                    Button("阅读", action: open).font(.subheadline).accessibilityLabel("阅读，\(item.title)")
                    Spacer(minLength: 2)
                    Button(action: details) { Image(systemName: "info.circle").frame(width: 44, height: 44) }
                        .accessibilityLabel("\(item.title)，书籍详情")
                } else if !isActive {
                    Button("下载并阅读", systemImage: "icloud.and.arrow.down", action: open)
                        .font(.subheadline)
                        .disabled(downloadUnavailable)
                        .accessibilityLabel("下载并阅读，\(item.title)")
                }
            }
            .buttonStyle(.borderless)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private var cover: some View {
        ShelfBookCover(title: item.title, author: item.author)
            .aspectRatio(0.70, contentMode: .fit)
    }
}
