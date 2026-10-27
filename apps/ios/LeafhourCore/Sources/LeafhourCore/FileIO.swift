import Foundation
import CryptoKit

struct FileDigest: Codable, Sendable { var path: String; var sha256: String; var bytes: Int64 }
struct OfflineManifest: Codable, Sendable { var version: Int = 1; var bookID: String; var files: [FileDigest] }
enum Disk {
    static let fm = FileManager.default
    static func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    static func hashFile(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
        var hash = SHA256()
        while let data = try handle.read(upToCount: 1_048_576), !data.isEmpty { try Task.checkCancellation(); hash.update(data: data) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }
    static func size(_ url: URL) throws -> Int64 { (try fm.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value ?? 0 }
    static func write<T: Encodable>(_ value: T, to url: URL) throws {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(value).write(to: url, options: .atomic)
    }
    static func read<T: Decodable>(_ type: T.Type, from url: URL) throws -> T { try JSONDecoder().decode(type, from: Data(contentsOf: url)) }
    static func directory(_ url: URL) throws { try fm.createDirectory(at: url, withIntermediateDirectories: true) }
    static func validID(_ id: String) throws { guard id.count == 64, id.allSatisfy({ "0123456789abcdef".contains($0) }) else { throw LibraryError.invalid("书籍标识无效。") } }
    static func safePath(_ path: String) throws -> String {
        guard !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\"), !path.contains("\0"), !path.contains(":"), path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { throw LibraryError.invalid("书籍包含不安全的文件路径。") }
        return path
    }
    static func url(_ root: URL, _ relative: String) throws -> URL {
        let path = try safePath(relative)
        var result = root
        for part in path.split(separator: "/") {
            result.appendPathComponent(String(part))
            if (try? result.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true { throw LibraryError.invalid("书籍目录不能包含符号链接。") }
        }
        return result
    }
    static func resolve(_ href: String, relativeTo source: String) throws -> String {
        let path = String(href.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)[0]).split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)[0]
        guard let decoded = String(path).removingPercentEncoding, !decoded.hasPrefix("/"), !decoded.contains(":"), !decoded.contains("\\"), !decoded.contains("\0") else { throw LibraryError.invalid("书籍引用了不支持的外部或无效资源。") }
        var parts = source.split(separator: "/").dropLast().map(String.init)
        for part in decoded.split(separator: "/", omittingEmptySubsequences: false) {
            if part == "." || part.isEmpty { continue }
            if part == ".." { guard !parts.isEmpty else { throw LibraryError.invalid("书籍资源越过了原件目录。") }; parts.removeLast() }
            else { parts.append(String(part)) }
        }
        return try safePath(parts.joined(separator: "/"))
    }
}
