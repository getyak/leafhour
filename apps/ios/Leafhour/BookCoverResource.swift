import SwiftUI
import PDFKit
import ImageIO
import LeafhourCore

struct BookCoverResource {
    let key: String
    let book: LocalBook?
    let path: String?
    let ownerID: String?
    let cloud: CloudLibraryClient
    let library: OfflineLibrary?

    private static let cache = CloudCoverCache(directory: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("LeafhourCovers", isDirectory: true))

    func load() async -> UIImage? {
        if let ownerID, let path, let bytes = try? await Self.cache.data(path: path, ownerID: ownerID, client: cloud) {
            guard !Task.isCancelled, await cloud.activeAccount()?.id == ownerID else { return nil }
            return Self.thumbnail(bytes)
        }
        guard !Task.isCancelled, let book, book.cloud == nil, let library else { return nil }
        let localCover = try? await library.localCoverURL(book.id)
        let original = try? await library.originalURL(book.id)
        return await Task.detached(priority: .utility) {
            if book.kind == .pdf, let original, let page = PDFDocument(url: original)?.page(at: 0) {
                return page.thumbnail(of: CGSize(width: 420, height: 630), for: .mediaBox)
            }
            if let localCover, let bytes = try? Data(contentsOf: localCover) { return Self.thumbnail(bytes) }
            return nil
        }.value
    }

    private static func thumbnail(_ bytes: Data) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(bytes as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 840, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary) else { return nil }
        return UIImage(cgImage: image)
    }
}

extension LibraryModel {
    func coverResource(_ item: LibraryShelfItem) -> BookCoverResource {
        let owner = account?.id
        let identity = item.local?.cloud
        let path = item.cloud?.coverPath ?? identity.map { "/api/library/books/" + CloudJSON.component($0.bookID) + "/cover?v=" + CloudJSON.component($0.contentVersion) }
        return BookCoverResource(key: (owner ?? "device") + ":" + item.id + ":" + (path ?? item.local?.sourceVersion ?? ""), book: item.local, path: path,
                                 ownerID: owner, cloud: cloud, library: library)
    }
    func coverResource(_ book: LocalBook) -> BookCoverResource {
        coverResource(LibraryShelfItem(id: book.id, local: book, cloud: cloudBooks.first { $0.id == book.cloud?.bookID }))
    }
}
