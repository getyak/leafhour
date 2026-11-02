import Foundation

extension OfflineLibrary {
    /// Shelf visibility only: packages, stable identities and every personal-state file stay in place.
    public func localArchivedBookIDs() throws -> Set<String> {
        let file = root.appendingPathComponent("local-shelf-archive.json")
        guard Disk.fm.fileExists(atPath: file.path) else { return [] }
        let ids = try Disk.read(Set<String>.self, from: file)
        for id in ids { try Disk.validID(id) }
        return ids
    }

    public func setLocalArchived(_ ids: Set<String>, archived: Bool) throws {
        // Validate the entire batch before the single atomic metadata write.
        for id in ids {
            let directory = try bookDirectory(id)
            guard Disk.fm.fileExists(atPath: directory.appendingPathComponent("book.json").path) else {
                throw LibraryError.invalid("书籍暂不可用，未改动书架。")
            }
        }
        var saved = try localArchivedBookIDs()
        if archived { saved.formUnion(ids) } else { saved.subtract(ids) }
        try Disk.write(saved, to: root.appendingPathComponent("local-shelf-archive.json"))
    }
}
