import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { clearLogSink, emitLog, getRecentLogs } from './log-sink.ts';

describe('getRecentLogs', () => {
    beforeEach(() => {
        clearLogSink();
    });

    it('returns the most recent entries in chronological order', () => {
        emitLog({ source: 'js', level: 'info', message: 'first' });
        emitLog({ source: 'native', level: 'warn', message: 'second' });
        emitLog({ source: 'sing-box', level: 'error', message: 'third' });

        const recent = getRecentLogs(2);
        assert.equal(recent.length, 2);
        assert.equal(recent[0].message, 'second');
        assert.equal(recent[1].message, 'third');
    });

    it('returns all entries when count exceeds buffer size', () => {
        emitLog({ source: 'js', level: 'info', message: 'only' });
        assert.equal(getRecentLogs(50).length, 1);
    });

    it('returns empty array for empty buffer and non-positive count', () => {
        assert.deepEqual(getRecentLogs(5), []);
        emitLog({ source: 'js', level: 'info', message: 'x' });
        assert.deepEqual(getRecentLogs(0), []);
        assert.deepEqual(getRecentLogs(-1), []);
    });
});
