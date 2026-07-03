/**
 * QR payload recognition — pure parser extracted from camera-qr.tsx so it can
 * be unit-tested without the scanner's native imports (expo-camera / router /
 * the log-sink → react chain).
 *
 * Recognises two shapes:
 *   - the app scheme `oneoh-networktools://config?data=…&apply=…`
 *   - a plain `https://…` URL, base64-encoded into the `data` field
 *
 * The optional logger records the decision branch and any parse failure so a
 * stuck import flow can be traced back to the recognition step (scheme match
 * vs. https fallback vs. rejection). It defaults to a no-op, keeping this
 * module dependency-free for the pure test runner; the scanner passes `jsLog`.
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
