import { mergeUserTunField, type TunConfigLike } from './tun-exclusions';

/**
 * iOS: NetworkExtension has no package concept, so carry the profile's
 * `route_exclude_address` (CIDRs excluded from the routed range) from the
 * imported config into the active config instead. Merged on top of the
 * template's own private-range exclusions. See the base
 * `apply-tun-exclusions.ts` for the platform-split rationale.
 */
export function applyPlatformTunExclusions(
    userConfig: TunConfigLike,
    templateConfig: TunConfigLike,
): void {
    mergeUserTunField(userConfig, templateConfig, 'route_exclude_address');
}
