// Carry a TUN-inbound bypass field from the user's imported config into the
// active (template-derived) config.
//
// The user's imported profile may itself be a full sing-box config that sets
// per-profile bypass lists on its `tun` inbound. We merge those into the
// config we actually run so the profile's intent survives template generation:
//   Android → exclude_package       (apps whose sockets bypass the tunnel)
//   iOS     → route_exclude_address  (CIDRs excluded from the routed range)
// Both are array fields on the `tun` inbound. Platform selection lives in
// `apply-tun-exclusions.*`; this core is platform-agnostic.
//
// Pure module: ZERO native imports so node --experimental-strip-types can run
// its sibling test directly.

interface TunInboundLike {
    type?: string;
    [k: string]: unknown;
}

export interface TunConfigLike {
    inbounds?: TunInboundLike[];
    [k: string]: unknown;
}

function findTunInbound(config: TunConfigLike | null | undefined): TunInboundLike | undefined {
    return config?.inbounds?.find((i) => i.type === 'tun');
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Union a string-array `field` from the user config's `tun` inbound into the
 * template config's `tun` inbound, in place.
 *
 * - No-op when either config lacks a `tun` inbound, or the user value is
 *   absent / empty / not a string array.
 * - Union + de-dupe: values already on the template inbound are kept and keep
 *   their order (e.g. the iOS template's private-range `route_exclude_address`
 *   defaults); the user's values are appended; duplicates collapse.
 *
 * Returns the template config for call-site convenience.
 */
export function mergeUserTunField(
    userConfig: TunConfigLike | null | undefined,
    templateConfig: TunConfigLike,
    field: string,
): TunConfigLike {
    const source = findTunInbound(userConfig);
    const target = findTunInbound(templateConfig);
    if (!source || !target) return templateConfig;

    const userValues = stringArray(source[field]);
    if (userValues.length === 0) return templateConfig;

    const merged = new Set<string>(stringArray(target[field]));
    for (const value of userValues) merged.add(value);
    target[field] = [...merged];
    return templateConfig;
}
