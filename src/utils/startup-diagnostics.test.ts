import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { djb2Hash } from './log-redact.ts';
import type { LogEntry } from './log-sink.ts';
import { configFingerprintOf, formatDiagnosticLogLine } from './startup-diagnostics.ts';

function entry(overrides: Partial<LogEntry>): LogEntry {
    return {
        id: 1,
        source: 'native',
        level: 'error',
        message: 'boom',
        time: Date.UTC(2026, 6, 10, 8, 55, 18, 356),
        ...overrides,
    };
}

describe('formatDiagnosticLogLine', () => {
    it('formats time, source, level and message', () => {
        assert.equal(
            formatDiagnosticLogLine(entry({})),
            '08:55:18.356 [native/error] boom',
        );
    });

    it('truncates overlong messages with an ellipsis', () => {
        const long = 'x'.repeat(400);
        const line = formatDiagnosticLogLine(entry({ message: long }));
        assert.ok(line.endsWith('…'));
        assert.ok(line.includes('x'.repeat(300)));
        assert.ok(!line.includes('x'.repeat(301)));
    });
});

describe('configFingerprintOf', () => {
    it('returns length and djb2 hash without leaking content', () => {
        const config = '{"outbounds":[]}';
        const fingerprint = configFingerprintOf(config);
        assert.equal(fingerprint, `len=${config.length} djb2=#${djb2Hash(config)}`);
        assert.ok(!fingerprint!.includes('outbounds'));
    });

    it('returns null for empty config', () => {
        assert.equal(configFingerprintOf(''), null);
    });
});
