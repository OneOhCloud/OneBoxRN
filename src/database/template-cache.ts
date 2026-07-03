import type { ConfigType } from '@/definition';

// In-memory cache for sing-box config templates, populated by
// `prefetchConfigTemplates` at app startup and read by `getConfigTemplate`.
//
// Why a wrapper around Map:
//   Downstream `buildSingBoxConfig` (config-merge-core.ts) mutates the
//   returned config object in place — it pushes user server nodes into the template's
//   `outbounds` / selector.outbounds / urltest.outbounds arrays. If the cache
//   handed out a shared object reference, those nodes would accumulate across
//   profile switches: switching from Profile A (20 nodes) to Profile B (10
//   nodes) would produce a runtime config with all 30 nodes in it.
//
//   Storing serialised JSON and parsing on every `get` gives each caller an
//   independent object graph, making the cache safe under mutation.
//
// Type-only import of `ConfigType` keeps this module free of any runtime
// dependency on `@/definition`, so the test file `template-cache.test.ts`
// can import it under Node's `--experimental-strip-types` runner without
// pulling in the project's native/expo-dependent modules.

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
    /** Test-only: wipe the cache between assertions. */
    clear(): void {
        this._store.clear();
    },
};
