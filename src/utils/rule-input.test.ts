import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    normalizeToken,
    parseBulkInput,
    validateToken,
} from './rule-input.ts';

test('validateToken: domain rejects scheme, space and empty', () => {
    assert.equal(validateToken('domain', 'http://x'), false);
    assert.equal(validateToken('domain', 'a b'), false);
    assert.equal(validateToken('domain', ''), false);
    assert.equal(validateToken('domain', 'example.com'), true);
});

test('validateToken: domain_suffix accepts an optional leading dot', () => {
    assert.equal(validateToken('domain_suffix', '.example.com'), true);
    assert.equal(validateToken('domain_suffix', 'example.com'), true);
    assert.equal(validateToken('domain_suffix', '.bad/seg'), false);
});

test('validateToken: ip_cidr accepts v4/v6 with an in-range prefix', () => {
    assert.equal(validateToken('ip_cidr', '1.2.3.0/24'), true);
    assert.equal(validateToken('ip_cidr', '10.0.0.1'), true);
    assert.equal(validateToken('ip_cidr', '2001:db8::/32'), true);
    assert.equal(validateToken('ip_cidr', '1.2.3.0/40'), false);
    assert.equal(validateToken('ip_cidr', '999.1.1.1'), false);
    assert.equal(validateToken('ip_cidr', 'example.com'), false);
});

test('normalizeToken trims and lowercases, blanks collapse to empty', () => {
    assert.equal(normalizeToken('  Example.COM '), 'example.com');
    assert.equal(normalizeToken('   '), '');
});

test('parseBulkInput splits on newlines and commas, dedupes first-seen', () => {
    assert.deepEqual(
        parseBulkInput('a.com,b.com\n c.com ,a.com'),
        ['a.com', 'b.com', 'c.com'],
    );
});
