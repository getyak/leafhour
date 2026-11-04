import Foundation

public struct ChatFollowUp: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let text: String
    public init(id: String, text: String) { self.id = id; self.text = text }
}

/// Suggestions propose a next question. They never claim that an AI phrase is author text.
public enum ChatFollowUps {
    public static func make(parentID: String, answer: String, question: String = "", supplied: [ChatFollowUp] = []) -> [ChatFollowUp] {
        var texts: [String] = [], seen = Set<String>()
        func append(_ text: String) {
            let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
            let key = value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            guard !value.isEmpty, value.count <= 180, !value.contains("\n"), !value.contains("http://"), !value.contains("https://"), !value.contains("<"), seen.insert(key).inserted else { return }
            texts.append(value)
        }
        for item in supplied { append(item.text); if texts.count == 3 { break } }
        if texts.count == 3 { return texts.enumerated().map { ChatFollowUp(id: parentID + "-follow-" + String($0.offset + 1), text: $0.element) } }
        let phrases = anchors(answer.isEmpty ? question : answer)
        let first = phrases.first ?? String(question.trimmingCharacters(in: .whitespacesAndNewlines).prefix(24))
        let a = first.isEmpty ? "这次讨论" : first, b = phrases.dropFirst().first ?? a
        for candidate in ["你刚才说“\(a)”，能展开解释吗？", "关于“\(b)”，能举一个具体例子吗？", "“\(a)”与原文的哪些细节有关？"] {
            if texts.count < 3 { append(candidate) }
        }
        // A supplied string can coincide with one fallback. Additional distinct questions
        // retain the actual response anchor rather than silently returning fewer than three.
        for candidate in ["“\(a)”还有哪些需要核对的地方？", "如何把“\(b)”和前面的讨论联系起来？", "“\(a)”适用于什么情况？"] {
            if texts.count < 3 { append(candidate) }
        }
        return texts.prefix(3).enumerated().map { ChatFollowUp(id: parentID + "-follow-" + String($0.offset + 1), text: $0.element) }
    }
    private static func anchors(_ source: String) -> [String] {
        // Process only a short already-rendered prefix, independent of answer/book length.
        let text = String(source.prefix(1600)), ns = text as NSString
        var candidates: [String] = []
        for pattern in [#"[“「《]([^”」》\n]{2,36})[”」》]"#, #"\*\*([^*\n]{2,36})\*\*"#, #"`([^`\n]{2,36})`"#] {
            if let regex = try? NSRegularExpression(pattern: pattern) {
                for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)).prefix(4) {
                    candidates.append(ns.substring(with: match.range(at: 1)))
                }
            }
        }
        let clauses = text.components(separatedBy: CharacterSet(charactersIn: "。！？.!?\n；;"))
        candidates.append(contentsOf: clauses.filter { $0.trimmingCharacters(in: .whitespacesAndNewlines).count >= 3 })
        var seen = Set<String>()
        return candidates.compactMap { value in
            let clean = value.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "#*>-_ \"“”「」")))
            guard !clean.isEmpty else { return nil }
            let clipped = String(clean.prefix(28))
            guard seen.insert(clipped).inserted else { return nil }
            return clipped
        }.prefix(3).map { $0 }
    }
}
