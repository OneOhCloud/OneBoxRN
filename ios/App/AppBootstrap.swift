import Observation

/// SwiftUI scene 重算可能重复触发 task；本状态只允许一次装配，并且只发布完整结果。
@MainActor
@Observable
final class AppBootstrap<Value> {
    private(set) var value: Value?

    @ObservationIgnored private let assemble: @MainActor () async -> Value
    @ObservationIgnored private var assemblyTask: Task<Void, Never>?

    var isLoading: Bool { value == nil }

    init(assemble: @escaping @MainActor () async -> Value) {
        self.assemble = assemble
    }

    func start() {
        guard value == nil, assemblyTask == nil else { return }
        assemblyTask = Task { @MainActor [weak self] in
            guard let self else { return }
            let assembled = await assemble()
            value = assembled
            assemblyTask = nil
        }
    }
}
