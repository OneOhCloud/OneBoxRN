struct DeferredRouteQueue<Route: Equatable> {
    private var pendingRoute: Route?

    var hasPendingRoute: Bool {
        pendingRoute != nil
    }

    mutating func enqueue(_ route: Route) {
        pendingRoute = route
    }

    mutating func drain(currentRoute: Route?) -> Route? {
        guard let route = pendingRoute else { return nil }
        pendingRoute = nil
        return route == currentRoute ? nil : route
    }
}
