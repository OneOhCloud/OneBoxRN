import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCoreLineLevel, sbLevelToEntryLevel } from './core-log.ts';

describe('parseCoreLineLevel', () => {
    it('parses the fixed sing-box level prefix', () => {
        assert.equal(parseCoreLineLevel('INFO[0000] inbound started'), 'info');
        assert.equal(parseCoreLineLevel('ERROR[0012] dial failed'), 'error');
        assert.equal(parseCoreLineLevel('TRACE[0000] x'), 'trace');
    });

    it('normalizes WARNING to warn', () => {
        assert.equal(parseCoreLineLevel('WARNING[0001] slow'), 'warn');
    });

    it('strips ANSI colour codes around the level token', () => {
        assert.equal(parseCoreLineLevel('\x1b[31mERROR\x1b[0m[0000] red'), 'error');
    });

    it('returns null for lines without a level prefix', () => {
        assert.equal(parseCoreLineLevel('no prefix here'), null);
        assert.equal(parseCoreLineLevel(''), null);
    });
});

describe('sbLevelToEntryLevel', () => {
    it('maps fatal/panic/error to error, warn to warn, rest to info', () => {
        assert.equal(sbLevelToEntryLevel('fatal'), 'error');
        assert.equal(sbLevelToEntryLevel('panic'), 'error');
        assert.equal(sbLevelToEntryLevel('error'), 'error');
        assert.equal(sbLevelToEntryLevel('warn'), 'warn');
        assert.equal(sbLevelToEntryLevel('info'), 'info');
        assert.equal(sbLevelToEntryLevel('debug'), 'info');
        assert.equal(sbLevelToEntryLevel('trace'), 'info');
    });
});
