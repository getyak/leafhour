import Dispatch
extension SourceTextOffsets {
    var measuredCheckpointCount: Int { checkpoints.count }
    var measuredLogicalAuxBytes: Int { checkpoints.count * MemoryLayout<Checkpoint>.stride }
}
@inline(never) func oldOffset(_ source: String, _ offset: Int) -> Int {
    (source as NSString).substring(to: offset).unicodeScalars.count
}
@inline(never) func newOffset(_ source: SourceTextOffsets, _ offset: Int) -> Int { source.scalarOffset(forUTF16Offset: offset) }
@inline(never) func construct(_ source: String) -> SourceTextOffsets { SourceTextOffsets(source) }
func elapsed<T>(_ body: () -> T) -> (T, Double) {
    let start = DispatchTime.now().uptimeNanoseconds
    let value = body()
    return (value, Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000)
}
func summary(_ values: [Double]) -> [String: Double] {
    let a = values.sorted()
    return ["medianMs": a[a.count / 2], "p95Ms": a[Int(Double(a.count - 1) * 0.95)], "minMs": a.first!, "maxMs": a.last!]
}
var reports: [[String: Any]] = [], checksum = 0
for (label, unit) in [("ascii", "reader "), ("bmp", "字e\u{301} "), ("mixed", "a字😀e\u{301} ")] {
    for count in [8, 32_000, 128_000] {
        let source = String(repeating: unit, count: count), width = unit.utf16.count
        let index = construct(source)
        var oldTimes: [Double] = [], newTimes: [Double] = [], buildTimes: [Double] = []
        for i in 0..<12 {
            let input = String(source.dropLast()) + String(i % 10) // Equal-length distinct input, constructed outside timer.
            let (created, ms) = elapsed { construct(input) }
            checksum += created.scalarOffset(forUTF16Offset: input.utf16.count / 2)
            if i >= 2 { buildTimes.append(ms) }
        }
        for i in 0..<50 {
            let offset = ((i * 7919) % (count - 1) + 1) * width
            let old: (Int, Double), new: (Int, Double)
            if i % 2 == 0 {
                old = elapsed { autoreleasepool { oldOffset(source, offset) } }
                new = elapsed { newOffset(index, offset) }
            } else {
                new = elapsed { newOffset(index, offset) }
                old = elapsed { autoreleasepool { oldOffset(source, offset) } }
            }
            precondition(old.0 == new.0)
            checksum += old.0 + new.0
            if i >= 2 { oldTimes.append(old.1); newTimes.append(new.1) }
        }
        reports.append(["case": label, "sourceUTF8Bytes": source.utf8.count, "sourceUTF16Units": index.utf16Count, "sourceScalars": index.scalarCount,
                        "lookupSamples": oldTimes.count, "constructionSamples": buildTimes.count, "oldLookup": summary(oldTimes), "newLookup": summary(newTimes),
                        "construction": summary(buildTimes), "checkpointCount": index.measuredCheckpointCount, "logicalAuxiliaryBytes": index.measuredLogicalAuxBytes])
    }
}
let result: [String: Any] = ["scope": "host Foundation release -O component comparison; construction separate; logical checkpoint fields exclude allocator/object/text storage; not RSS/UIKit/FPS/physical latency", "os": ProcessInfo.processInfo.operatingSystemVersionString, "checksum": checksum, "results": reports]
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]))
