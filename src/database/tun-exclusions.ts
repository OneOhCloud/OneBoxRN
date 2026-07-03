// 把一个 TUN inbound 的绕行字段从用户导入的配置带入当前生效（模板派生）的配置。
//
// 用户导入的配置文件本身可能就是一份完整的 sing-box 配置，在其 `tun` inbound
// 上设置了按配置文件的绕行列表。我们把它们合并进真正运行的配置，使配置文件的
// 意图能在模板生成后存活：
//   Android → exclude_package       （其 socket 绕过隧道的 app）
//   iOS     → route_exclude_address  （从路由范围内排除的 CIDR）
// 两者都是 `tun` inbound 上的数组字段。平台选择在 `apply-tun-exclusions.*`；
// 本核心与平台无关。
//
// 纯模块：零原生 import，使 node --experimental-strip-types 能直接运行 sibling
// test。

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
 * 就地把用户配置 `tun` inbound 上的字符串数组字段 `field` 并集合并进模板配置的
 * `tun` inbound。
 *
 * - 任一配置缺少 `tun` inbound，或用户值缺失 / 为空 / 非字符串数组时，为空操作。
 * - 并集 + 去重：模板 inbound 上已有的值保留并保持顺序（例如 iOS 模板的私有
 *   网段 `route_exclude_address` 默认值）；用户的值追加在后；重复项折叠。
 *
 * 返回模板配置，方便调用点使用。
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
