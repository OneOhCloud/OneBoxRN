import { mergeUserTunField, type TunConfigLike } from './tun-exclusions';

/**
 * Android: carry the profile's `exclude_package` (apps that bypass the tunnel)
 * from the imported config into the active config. See the base
 * `apply-tun-exclusions.ts` for the platform-split rationale.
 */
export function applyPlatformTunExclusions(
    userConfig: TunConfigLike,
    templateConfig: TunConfigLike,
): void {
    mergeUserTunField(userConfig, templateConfig, 'exclude_package');
}
