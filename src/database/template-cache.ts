import type { ConfigType } from '@/definition';

// sing-box 配置模板的内存缓存，由 `prefetchConfigTemplates` 在 app 启动时填充，
// 由 `getConfigTemplate` 读取。
//
// 为什么要在 Map 外包一层：
//   下游 `buildSingBoxConfig`（config-merge-core.ts）会就地修改返回的配置对象
//   —— 它把用户的服务器节点 push 进模板的 `outbounds` / selector.outbounds /
//   urltest.outbounds 数组。若缓存交出共享的对象引用，这些节点会在切换配置文件
//   时累积：从配置文件 A（20 个节点）切到配置文件 B（10 个节点）会产出一份含
//   全部 30 个节点的运行时配置。
//
//   以序列化 JSON 存储、每次 `get` 时解析，可给每个调用方独立的对象图，使缓存
//   在被修改时依然安全。
//
// 对 `ConfigType` 采用 type-only import，使本模块不带任何对 `@/definition` 的
// 运行时依赖，从而测试文件 `template-cache.test.ts` 能在 Node 的
// `--experimental-strip-types` 运行器下 import 它，而不牵入项目的原生/expo
// 依赖模块。

type Dict = any;

export const templateMemoryCache = {
    _store: new Map<ConfigType, string>(),
    get(mode: ConfigType): Dict | undefined {
        const raw = this._store.get(mode);
        return raw ? JSON.parse(raw) : undefined;
    },
    set(mode: ConfigType, value: Dict): void {
        this._store.set(mode, JSON.stringify(value));
    },
    /** 仅测试用：在断言之间清空缓存。 */
    clear(): void {
        this._store.clear();
    },
};
