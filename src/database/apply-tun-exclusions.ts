import type { TunConfigLike } from './tun-exclusions';

/**
 * Merge the user profile's TUN bypass field into the active config, in place.
 *
 * Platform-split (`.android.ts` / `.ios.ts` / base): which `tun` inbound field
 * carries the bypass list differs by platform —
 *   Android → exclude_package, iOS → route_exclude_address.
 * This base implementation serves Web, which never builds a TUN config, so it
 * is intentionally a no-op. Per the project rule, the divergence lives in
 * platform files rather than a runtime `Platform.OS` branch in shared logic.
 */
export function applyPlatformTunExclusions(
    _userConfig: TunConfigLike,
    _templateConfig: TunConfigLike,
): void {
    // no-op on Web
}
