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
            let lower = value.lowercased()
            let key = value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            guard !value.isEmpty, value.count <= 180, !value.contains("\n"), !lower.contains("http://"), !lower.contains("https://"), !lower.contains("www."), !value.contains("<"), seen.insert(key).inserted else { return }
            texts.append(value)
        }
        for item in supplied { append(item.text); if texts.count == 3 { break } }
        if texts.count == 3 { return texts.enumerated().map { ChatFollowUp(id: parentID + "-follow-" + String($0.offset + 1), text: $0.element) } }
        let phrases = anchors(answer) + anchors(question)
        if let a = phrases.first {
            let b = phrases.dropFirst().first ?? a
            for candidate in ["这次讨论中“\(a)”具体是什么意思？", "关于“\(b)”，能举一个具体例子吗？", "“\(a)”与原文的哪些细节有关？"] {
                if texts.count < 3 { append(candidate) }
            }
        }
        // Unsafe/empty source phrases must not make every candidate fail the same
        // validation. These three distinct questions make no invented factual claim
        // and do not quote or rewrite comparison expressions, URLs or source code.
        for candidate in ["能把刚才的回答解释得更具体一些吗？", "能举一个帮助理解这次讨论的例子吗？", "这次回答里，哪些内容还需要核对？"] {
            if texts.count < 3 { append(candidate) }
        }
        return texts.prefix(3).enumerated().map { ChatFollowUp(id: parentID + "-follow-" + String($0.offset + 1), text: $0.element) }
    }
    private static func anchors(_ source: String) -> [String] {
        // Process only a short already-rendered prefix, independent of answer/book length.
        let text = String(source.prefix(1600))
            .replacingOccurrences(of: #"(?i)(?:https?://|www\.)[^\s<>()]+"#, with: "\n", options: .regularExpression)
            .replacingOccurrences(of: #"(?m)^\s*```[^\n]*"#, with: "\n", options: .regularExpression)
        let ns = text as NSString
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
            guard !clean.isEmpty, !clean.contains("<") else { return nil }
            let clipped = String(clean.prefix(28))
            guard seen.insert(clipped).inserted else { return nil }
            return clipped
        }.prefix(3).map { $0 }
    }
}
