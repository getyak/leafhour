import Foundation

extension OfflineLibrary {
    /// A single profile-scoped file wins over all legacy per-book snapshots.
    /// Book progress, notes, drafts and listening positions remain untouched.
    func readerPreferences(legacy: ReaderPreferences?) throws -> ReaderPreferences {
        let file = root.appendingPathComponent("reader-preferences.json")
        if Disk.fm.fileExists(atPath: file.path) {
            do {
                let value = try Disk.read(ReaderPreferences.self, from: file)
                try Self.validateReaderPreferences(value)
                return value
            } catch {
                throw LibraryError.invalid("通用阅读设置无法读取，原文件已保留。请先导出恢复，勿重置。")
            }
        }
        var migrated = legacy
        // Before this version, default scroll and an explicit scroll choice
        // were encoded identically. Preserve every valid stored choice.
        if let lastID = try? lastOpenedBook(),
           let directory = try? bookDirectory(lastID),
           Disk.fm.fileExists(atPath: directory.appendingPathComponent("manifest.json").path),
           let previous = try? Disk.read(ReaderState.self, from: root.appendingPathComponent("states/" + lastID + ".json")),
           (try? Self.validateReaderPreferences(previous.preferences)) != nil {
            migrated = previous.preferences
        }
        let value = migrated ?? ReaderPreferences()
        try Self.validateReaderPreferences(value)
        try Disk.write(value, to: file)
        return value
    }

    public func saveReaderPreferences(_ preferences: ReaderPreferences) throws {
        try Self.validateReaderPreferences(preferences)
        // A failed/corrupt preference file is recovery evidence, not permission
        // to replace it on a later unrelated book or progress write.
        let file = root.appendingPathComponent("reader-preferences.json")
        if Disk.fm.fileExists(atPath: file.path) {
            do { try Self.validateReaderPreferences(Disk.read(ReaderPreferences.self, from: file)) }
            catch { throw LibraryError.invalid("通用阅读设置无法读取，原文件已保留。请先导出恢复，勿重置。") }
        }
        try Disk.write(preferences, to: file)
    }

    static func validateReaderPreferences(_ value: ReaderPreferences) throws {
        guard value.fontSize.isFinite, (16...36).contains(value.fontSize),
              value.lineSpacing.isFinite, (4...18).contains(value.lineSpacing),
              ReaderPaper(rawValue: value.theme) != nil,
              value.speechSpeed.isFinite, (0.5...5).contains(value.speechSpeed),
              value.pageTapDelay.isFinite, (0...0.5).contains(value.pageTapDelay),
              value.autoPageInterval.isFinite, (5...120).contains(value.autoPageInterval),
              value.autoPageInterval.truncatingRemainder(dividingBy: 5) == 0 else {
            throw LibraryError.invalid("阅读设置超出支持范围。")
        }
    }
}
