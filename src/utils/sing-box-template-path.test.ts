import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildTemplateCacheKey, parseSingBoxVersion, resolveVersionPath } from './sing-box-template-path.ts';

describe('parseSingBoxVersion', () => {
    it('parses a full version string', () => {
        assert.deepEqual(parseSingBoxVersion('1.13.8'), { major: '1', minor: '13', patch: 8 });
    });

    it('parses patch 0', () => {
        assert.deepEqual(parseSingBoxVersion('1.13.0'), { major: '1', minor: '13', patch: 0 });
    });

    it('parses a prerelease without truncating its identity', () => {
        assert.deepEqual(parseSingBoxVersion('v1.14.0-beta.10'), {
            major: '1',
            minor: '14',
            patch: 0,
            prerelease: 'beta.10',
        });
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

    it('1.14 prereleases use the 1.14 bucket', () => {
        assert.equal(resolveVersionPath(parseSingBoxVersion('v1.14.0-beta.10')), '1.14');
    });

    it('rejects a malformed prerelease', () => {
        assert.throws(() => parseSingBoxVersion('v1.14.0-'), /malformed/);
    });

    it('2.0.0 throws unsupported', () => {
        assert.throws(() => resolveVersionPath(parseSingBoxVersion('2.0.0')), /Unsupported/);
    });
});

describe('buildTemplateCacheKey', () => {
    it('embeds app version, sing-box minor and mode', () => {
        const key = buildTemplateCacheKey('1.0.14', '1.13', 'tun-rules');
        assert.equal(key, 'key-sing-box-1.13-app-1.0.14-tun-rules-template-config-cache');
    });

    it('a new app version produces a different key (instant invalidation)', () => {
        const oldKey = buildTemplateCacheKey('1.0.14', '1.13', 'tun-rules');
        const newKey = buildTemplateCacheKey('1.0.15', '1.13', 'tun-rules');
        assert.notEqual(oldKey, newKey);
    });

    it('is stable for identical inputs', () => {
        assert.equal(
            buildTemplateCacheKey('1.0.14', '1.13', 'tun-global'),
            buildTemplateCacheKey('1.0.14', '1.13', 'tun-global'),
        );
    });

    it('separates modes under the same app version', () => {
        assert.notEqual(
            buildTemplateCacheKey('1.0.14', '1.13', 'tun-rules'),
            buildTemplateCacheKey('1.0.14', '1.13', 'tun-global'),
        );
    });
});
