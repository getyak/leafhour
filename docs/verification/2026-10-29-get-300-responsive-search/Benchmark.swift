import Foundation
import Dispatch
import UIKit

@main struct Benchmark {
    static func main() throws {
        let source = try String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
        let samples = source.components(separatedBy: "\n\n").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        let passages = (0..<3000).map { samples[$0 % samples.count] }
        var cases: [[String: Any]] = []
        for query in ["Alice", "waistcoat-pocket", "unmatched-benchmark-query"] {
            var milliseconds: [Double] = []
            var count = 0
            for _ in 0..<3 {
                let start = DispatchTime.now().uptimeNanoseconds
                let results = passages.compactMap { SearchExcerpt.find(in: $0, query: query) }
                milliseconds.append(Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000)
                count = results.count
            }
            cases.append(["query": query, "matches": count, "milliseconds": milliseconds])
        }
        let output: [String: Any] = [
            "runtime": UIDevice.current.systemName + " " + UIDevice.current.systemVersion,
            "scope": "Synthetic 3000-passage synchronous core scan; public fixture paragraphs repeated; not app input latency or physical-device evidence",
            "onMainThread": Thread.isMainThread,
            "passages": passages.count,
            "sourceParagraphs": samples.count,
            "logicalSourceScalars": passages.reduce(0) { $0 + $1.unicodeScalars.count },
            "cases": cases
        ]
        print(String(data: try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
    }
}
