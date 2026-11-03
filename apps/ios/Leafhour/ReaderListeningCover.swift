import UIKit
import PDFKit
import ImageIO
import LeafhourCore

@MainActor protocol ReaderListeningCoverLoading {
    func load(book: LocalBook, original: URL, directory: URL, cloud: CloudLibraryClient?, library: OfflineLibrary?) async -> UIImage?
}

/// Reuses authenticated cover access; local originals are decoded off the main
/// actor with a fixed thumbnail bound and no upload or text extraction.
@MainActor struct ReaderListeningCoverLoader: ReaderListeningCoverLoading {
    func load(book: LocalBook, original: URL, directory: URL, cloud: CloudLibraryClient?, library: OfflineLibrary?) async -> UIImage? {
        if let identity = book.cloud {
            guard let cloud, !Task.isCancelled, await cloud.activeAccount()?.id == identity.ownerID else { return nil }
            let path = "/api/library/books/" + CloudJSON.component(identity.bookID) + "/cover?v=" + CloudJSON.component(identity.contentVersion)
            let resource = BookCoverResource(key: identity.ownerID + ":" + book.id + ":" + identity.contentVersion,
                book: book, path: path, ownerID: identity.ownerID, cloud: cloud, library: library)
            return await resource.load()
        }
        guard !Task.isCancelled else { return nil }
        let coverURL: URL?
        let originalURL: URL
        if let library {
            coverURL = try? await library.localCoverURL(book.id)
            originalURL = (try? await library.originalURL(book.id)) ?? original
        } else {
            coverURL = Self.containedCover(book.coverResourcePath, directory: directory)
            originalURL = original
        }
        guard !Task.isCancelled else { return nil }
        let decode = Task.detached(priority: .utility) { () -> UIImage? in
            guard !Task.isCancelled else { return nil }
            if let coverURL,
               let metadata = try? coverURL.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey]),
               metadata.isRegularFile == true, let size = metadata.fileSize, size > 0, size <= 4 * 1024 * 1024,
               let source = CGImageSourceCreateWithURL(coverURL as CFURL, nil),
               let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceThumbnailMaxPixelSize: 1024,
                    kCGImageSourceCreateThumbnailWithTransform: true
               ] as CFDictionary) {
                return Task.isCancelled ? nil : UIImage(cgImage: image)
            }
            guard book.kind == .pdf, !Task.isCancelled,
                  let page = PDFDocument(url: originalURL)?.page(at: 0) else { return nil }
            let bounds = page.bounds(for: .mediaBox)
            guard bounds.width > 0, bounds.height > 0, bounds.width.isFinite, bounds.height.isFinite else { return nil }
            let scale = 1024 / max(bounds.width, bounds.height)
            let image = page.thumbnail(of: CGSize(width: bounds.width * scale, height: bounds.height * scale), for: .mediaBox)
            return Task.isCancelled ? nil : image
        }
        return await withTaskCancellationHandler { await decode.value } onCancel: { decode.cancel() }
    }

    private static func containedCover(_ path: String?, directory: URL) -> URL? {
        guard let path, !path.isEmpty, !path.hasPrefix("/"), !path.split(separator: "/").contains("..") else { return nil }
        let assets = directory.appendingPathComponent("assets", isDirectory: true).standardizedFileURL.resolvingSymlinksInPath()
        let candidate = assets.appendingPathComponent(path).standardizedFileURL.resolvingSymlinksInPath()
        guard candidate.path.hasPrefix(assets.path + "/") else { return nil }
        return candidate
    }
}
