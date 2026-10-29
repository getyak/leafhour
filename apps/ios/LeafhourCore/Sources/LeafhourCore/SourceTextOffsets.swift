import Foundation

/// UTF-16 is used by the text system; saved anchors count the unchanged source's Unicode scalars.
public struct SourceTextOffsets: Sendable {
    private struct Checkpoint: Sendable {
        let index: String.Index
        let utf16: Int
        let scalar: Int
    }
    private static let stride = 1024
    private let source: String
    private let checkpoints: [Checkpoint]
    public let utf16Count: Int
    public let scalarCount: Int

    public init(_ source: String) {
        self.source = source
        utf16Count = source.utf16.count
        scalarCount = source.unicodeScalars.count
        var points: [Checkpoint] = []
        // BMP scalars have identical offsets, even when multiple scalars form one Character.
        if utf16Count != scalarCount && scalarCount > Self.stride {
            points.reserveCapacity(scalarCount / Self.stride)
            let scalars = source.unicodeScalars
            var index = scalars.startIndex, utf16 = 0, scalar = 0
            while index != scalars.endIndex {
                if scalar > 0 && scalar % Self.stride == 0 {
                    points.append(Checkpoint(index: index, utf16: utf16, scalar: scalar))
                }
                utf16 += scalars[index].value > 0xffff ? 2 : 1
                scalar += 1; scalars.formIndex(after: &index)
            }
        }
        checkpoints = points
    }

    /// Invalid positions inside a surrogate pair return the scalar's start, never a replacement scalar.
    public func scalarOffset(forUTF16Offset value: Int) -> Int {
        let target = min(max(0, value), utf16Count)
        if utf16Count == scalarCount || target == 0 { return target }
        if target == utf16Count { return scalarCount }
        let point = checkpoint(before: target, byUTF16: true)
        let scalars = source.unicodeScalars
        var index = point.index, utf16 = point.utf16, scalar = point.scalar
        while index != scalars.endIndex {
            let width = scalars[index].value > 0xffff ? 2 : 1
            guard utf16 + width <= target else { break }
            utf16 += width; scalar += 1
            if utf16 == target { break }
            scalars.formIndex(after: &index)
        }
        return scalar
    }

    public func utf16Offset(forScalarOffset value: Int) -> Int {
        let target = min(max(0, value), scalarCount)
        if utf16Count == scalarCount || target == 0 { return target }
        if target == scalarCount { return utf16Count }
        let point = checkpoint(before: target, byUTF16: false)
        let scalars = source.unicodeScalars
        var index = point.index, utf16 = point.utf16, scalar = point.scalar
        while scalar < target {
            utf16 += scalars[index].value > 0xffff ? 2 : 1
            scalar += 1; scalars.formIndex(after: &index)
        }
        return utf16
    }

    private func checkpoint(before target: Int, byUTF16: Bool) -> Checkpoint {
        var lower = 0, upper = checkpoints.count
        while lower < upper {
            let middle = lower + (upper - lower) / 2
            let offset = byUTF16 ? checkpoints[middle].utf16 : checkpoints[middle].scalar
            if offset <= target { lower = middle + 1 } else { upper = middle }
        }
        return lower > 0 ? checkpoints[lower - 1] : Checkpoint(index: source.unicodeScalars.startIndex, utf16: 0, scalar: 0)
    }
}
