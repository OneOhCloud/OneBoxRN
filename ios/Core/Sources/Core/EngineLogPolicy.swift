public enum EngineLogPolicy {
    public static let minimumLevel = LogLevel.info
    public static let maximumMessageBytes = 1024

    public static func accepts(_ level: LogLevel) -> Bool {
        level >= minimumLevel
    }

    public static func truncate(_ message: String) -> String {
        guard message.utf8.count > maximumMessageBytes else { return message }
        var bytes = Array(message.utf8.prefix(maximumMessageBytes))
        while String(bytes: bytes, encoding: .utf8) == nil, !bytes.isEmpty {
            bytes.removeLast()
        }
        return String(decoding: bytes, as: UTF8.self)
    }
}
