import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseSingBoxVersion, resolveVersionPath } from './sing-box-template-path.ts';

describe('parseSingBoxVersion', () => {
    it('parses a full version string', () => {
        assert.deepEqual(parseSingBoxVersion('1.13.8'), { major: '1', minor: '13', patch: 8 });
    });

    it('parses patch 0', () => {
        assert.deepEqual(parseSingBoxVersion('1.13.0'), { major: '1', minor: '13', patch: 0 });
    });

    it('throws on empty string', () => {
        assert.throws(() => parseSingBoxVersion(''), /empty/);
    });

    it('throws when patch is missing (only MAJOR.MINOR)', () => {
        assert.throws(() => parseSingBoxVersion('1.13'), /MAJOR\.MINOR\.PATCH/);
    });

    it('throws on non-numeric input', () => {
        assert.throws(() => parseSingBoxVersion('abc'), /MAJOR\.MINOR\.PATCH/);
    });
});

describe('resolveVersionPath', () => {
    it('1.13.0 → "1.13"', () => {
        assert.equal(resolveVersionPath(parseSingBoxVersion('1.13.0')), '1.13');
    });

    it('1.13.7 → "1.13"', () => {
        assert.equal(resolveVersionPath(parseSingBoxVersion('1.13.7')), '1.13');
    });

    it('1.13.8 → "1.13.8"', () => {
        assert.equal(resolveVersionPath(parseSingBoxVersion('1.13.8')), '1.13.8');
    });

    it('1.13.10 → "1.13.8"', () => {
        assert.equal(resolveVersionPath(parseSingBoxVersion('1.13.10')), '1.13.8');
    });

    it('1.12.5 → "1.12"', () => {
        assert.equal(resolveVersionPath(parseSingBoxVersion('1.12.5')), '1.12');
    });

    it('1.14.0 throws unsupported', () => {
        assert.throws(() => resolveVersionPath(parseSingBoxVersion('1.14.0')), /Unsupported/);
    });

    it('2.0.0 throws unsupported', () => {
        assert.throws(() => resolveVersionPath(parseSingBoxVersion('2.0.0')), /Unsupported/);
    });
});
