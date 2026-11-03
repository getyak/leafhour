import Foundation

/// Incremental NDJSON framing keeps split Unicode bytes intact until a full frame arrives.
public struct ChatStreamDecoder: Sendable {
    private var buffer = Data()
    private let maximumFrameBytes: Int
    public init(maximumFrameBytes: Int = 16 * 1024 * 1024) { self.maximumFrameBytes = maximumFrameBytes }
    public mutating func append(_ data: Data) throws -> [CloudJSON] {
        var frames: [CloudJSON] = []
        for byte in data {
            if byte == 10 {
                if let frame = try decodeBuffer() { frames.append(frame) }
                buffer.removeAll(keepingCapacity: true)
            } else {
                guard buffer.count < maximumFrameBytes else { throw LibraryError.invalid("回答的数据片段过大，请重试查看结果。") }
                buffer.append(byte)
            }
        }
        return frames
    }
    public mutating func finish() throws -> [CloudJSON] {
        defer { buffer.removeAll(keepingCapacity: false) }
        return try decodeBuffer().map { [$0] } ?? []
    }
    private func decodeBuffer() throws -> CloudJSON? {
        if buffer.allSatisfy({ $0 == 13 || $0 == 32 || $0 == 9 }) { return nil }
        return try CloudJSON.decode(buffer)
    }
}
