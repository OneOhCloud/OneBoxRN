/**
 * 二维码载荷识别 — 从 camera-qr.tsx 抽出的纯 parser，可脱离扫描器的原生依赖
 *（expo-camera / router / log-sink → react 链路）做单元测试。
 *
 * 识别两种形态：
 *   - 应用 scheme `oneoh-networktools://config?data=…&apply=…`
 *   - 纯 `https://…` URL，base64 编码后写入 `data` 字段
 *
 * 可选 logger 记录判定分支与解析失败，便于把卡住的导入流程回溯到识别这一步
 *（scheme 命中 vs. https 回落 vs. 拒绝）。默认 no-op，使本模块对纯测试 runner
 * 保持无依赖；扫描器传入 `jsLog`。
 */

export interface QRDataLogger {
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
}

const NOOP_LOGGER: QRDataLogger = {
    debug() {},
    info() {},
    warn() {},
};

export type ResolvedQRData = { data: string; apply?: string };

const SCHEME = 'oneoh-networktools://config';

export function resolveQRData(
    raw: string,
    log: QRDataLogger = NOOP_LOGGER,
): ResolvedQRData | null {
    log.debug(`[QR] resolveQRData: bytes=${raw.length}, prefix=${JSON.stringify(raw.slice(0, 48))}`);
    if (raw.startsWith(SCHEME)) {
        try {
            const url = new URL(raw);
            const data = url.searchParams.get('data');
            if (data) {
                const apply = url.searchParams.get('apply') ?? undefined;
                log.info(`[QR] resolveQRData: scheme match, dataBytes=${data.length}, apply=${apply ?? '(none)'}`);
                return { data, apply };
            }
            log.warn('[QR] resolveQRData: scheme match but data param missing');
        } catch (e) {
            log.warn(`[QR] resolveQRData: URL parse failed for scheme payload: ${(e as Error).message}`);
        }
        return null;
    }
    if (raw.startsWith('https://')) {
        const data = btoa(raw);
        log.info(`[QR] resolveQRData: plain https URL, encoded bytes=${data.length}`);
        return { data };
    }
    log.info('[QR] resolveQRData: unrecognized payload, neither scheme nor https');
    return null;
}
