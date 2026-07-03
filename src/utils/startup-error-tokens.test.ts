import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startupErrorTokenToKey } from './startup-error-tokens.ts';

describe('startupErrorTokenToKey', () => {
    it('maps known native tokens to i18n keys', () => {
        assert.equal(startupErrorTokenToKey('START_FAILED_GENERIC'), 'startup_error_generic');
        assert.equal(startupErrorTokenToKey('RULESET_DOWNLOAD_TIMEOUT'), 'ruleset_download_timeout');
    });

    it('trims surrounding whitespace before matching', () => {
        assert.equal(startupErrorTokenToKey('  START_FAILED_GENERIC \n'), 'startup_error_generic');
    });

    it('returns null for raw error detail and empty/null input', () => {
        assert.equal(startupErrorTokenToKey('[binary] invalid config: bad json'), null);
        assert.equal(startupErrorTokenToKey(''), null);
        assert.equal(startupErrorTokenToKey(null), null);
        assert.equal(startupErrorTokenToKey(undefined), null);
    });
});
