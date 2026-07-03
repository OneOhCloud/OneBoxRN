import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatBytes } from './format-bytes.ts';

describe('formatBytes', () => {
    it('clamps zero and negatives to 0 B', () => {
        assert.equal(formatBytes(0), '0 B');
        assert.equal(formatBytes(-1), '0 B');
    });

    it('shows raw bytes below 1 KB', () => {
        assert.equal(formatBytes(512), '512 B');
        assert.equal(formatBytes(1023), '1023 B');
    });

    it('formats KB / MB / GB with three significant figures', () => {
        assert.equal(formatBytes(1024), '1 KB');
        assert.equal(formatBytes(1536), '1.5 KB');
        assert.equal(formatBytes(1024 * 1024), '1 MB');
        assert.equal(formatBytes(10.5 * 1024 * 1024), '10.5 MB');
        assert.equal(formatBytes(100 * 1024 * 1024), '100 MB');
        assert.equal(formatBytes(1024 * 1024 * 1024), '1 GB');
        assert.equal(formatBytes(1.25 * 1024 * 1024 * 1024), '1.25 GB');
    });
});
