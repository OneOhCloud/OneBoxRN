import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canReuseGeneratedTemplateSnapshot } from './generated-template-snapshot.ts';

describe('generated template snapshot', () => {
    const snapshot = `
// Branch:  dev
// sing-box: v1.14.0-beta.10 (from helper Makefile)
export const template = {};`;

    it('requires the requested channel and exact core version', () => {
        assert.equal(canReuseGeneratedTemplateSnapshot(snapshot, 'dev', 'v1.14.0-beta.10'), true);
        assert.equal(canReuseGeneratedTemplateSnapshot(snapshot, 'stable', 'v1.14.0-beta.10'), false);
        assert.equal(canReuseGeneratedTemplateSnapshot(snapshot, 'dev', 'v1.13.15'), false);
    });

    it('rejects a file without generated metadata', () => {
        assert.equal(canReuseGeneratedTemplateSnapshot('export const template = {};', 'dev', 'v1.14.0-beta.10'), false);
    });
});
