import SwiftUI
import Core
import UIKit

/// 站点图标的进程内缓存：按图标地址记住「取到的图」或「取不到」，成功与失败都不再重打（参考实现同）；
/// 同一地址在途时，后来者等同一个请求，不另发。
///
/// 抓取跑在独立任务里：打开详情又立刻收起，视图那一侧的取消不会把这一次记成「取不到」。
@MainActor
final class SiteIconCache {
    static let shared = SiteIconCache(fetch: { [fetcher = SiteIconFetcher()] url in await fetcher.fetch(url) })

    enum Entry {
        case icon(Image)
        case unavailable
    }

    private let fetch: @Sendable (URL) async -> Data?
    private var entries: [String: Entry] = [:]
    private var pending: [String: Task<Data?, Never>] = [:]

    init(fetch: @escaping @Sendable (URL) async -> Data?) {
        self.fetch = fetch
    }

    /// 已有的结局：首帧直接用它，免得每次打开详情都先闪一下回落图标。还没取过 → nil。
    func known(_ address: String) -> Entry? { entries[address] }

    func entry(for address: String) async -> Entry {
        if let known = entries[address] { return known }
        let data = await (pending[address] ?? start(address)).value
        if let known = entries[address] { return known }
        let entry = data.flatMap(Self.decode).map(Entry.icon) ?? .unavailable
        entries[address] = entry
        pending[address] = nil
        return entry
    }

    private func start(_ address: String) -> Task<Data?, Never> {
        let fetch = self.fetch
        let task = Task { () -> Data? in
            guard let url = URL(string: address) else { return nil }
            return await fetch(url)
        }
        pending[address] = task
        return task
    }

    private static func decode(_ data: Data) -> Image? {
        UIImage(data: data).map(Image.init(uiImage:))
    }
}

extension SiteIconState {
    /// 缓存里的结局折成 core 认的三态：还没取过、正在取都是 `unknown`。
    init(_ entry: SiteIconCache.Entry?) {
        switch entry {
        case nil: self = .unknown
        case .icon?: self = .loaded
        case .unavailable?: self = .unavailable
        }
    }
}
