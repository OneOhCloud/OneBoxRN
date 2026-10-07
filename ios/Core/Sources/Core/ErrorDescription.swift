import Foundation

/// 失败详情的唯一构造口：**自带可读描述的用它，系统错误带域与码，其余原样描述**。
/// 镜像 Android core/ThrowableDescription.kt 的 `describe(Throwable)`。
///
/// 不直接用 `error.localizedDescription`：那个形状对系统错误只留下一句本地化文本，
/// 而描述随系统语言与厂商变，只有域与码才可检索、可跨机器比对。
public func describe(_ failure: Error) -> String {
    // 本仓与上游自己声明了可读描述的错误（`EngineError` → "TOKEN: detail"）：
    // 那已经是信息量最高的一份，桥出来的域码只会是「模块.类型名 + 分支序号」。
    // `LocalizedError` 的缺省实现返回 nil，故这一支恰好只命中显式声明过描述的类型。
    if let localized = (failure as? LocalizedError)?.errorDescription, !localized.isEmpty {
        return localized
    }
    // 按**动态类型**判断它是不是真的系统错误：`failure as? NSError` 恒成功（Swift 的 Error 到
    // NSError 有隐式桥接），拿它做判据会把每一个原生错误也走进域码分支，而原生错误桥出来的
    // `localizedDescription` 是一句「操作无法完成」的占位，关联值整个丢掉。
    guard type(of: failure) is NSError.Type else { return String(describing: failure) }
    let system = failure as NSError
    var detail = "\(system.domain) code=\(system.code)"
    if let path = filePath(of: system) { detail += " path=\(path)" }
    if let underlying = system.userInfo[NSUnderlyingErrorKey] as? NSError {
        detail += " underlying=\(underlying.domain) code=\(underlying.code)"
    }
    return "\(detail): \(system.localizedDescription)"
}

/// 文件错误的本地化文本只剩最后一段文件名，整条路径才分得清是哪一处；只取本地路径，远端地址不进日志。
private func filePath(of error: NSError) -> String? {
    if let path = error.userInfo[NSFilePathErrorKey] as? String { return path }
    guard let url = error.userInfo[NSURLErrorKey] as? URL, url.isFileURL else { return nil }
    return url.path
}
