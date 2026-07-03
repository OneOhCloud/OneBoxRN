import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { djb2Hash, redactHostname, redactUrl } from './log-redact.ts';

describe('djb2Hash', () => {
    it('produces the stable known vector', () => {
        // djb2("abc") = ((5381*33+97)*33+98)*33+99 = 193485963 → base36
        assert.equal(djb2Hash('abc'), (193485963).toString(36));
    });

    it('matches the legacy kv.ts hashUrl output (KV key compat guard)', () => {
        // 内联的参考 djb2 实现 —— TaskLog 的 KV key 必须保持稳定，不能变。
        function legacyHashUrl(url: string): string {
            let h = 5381;
            for (let i = 0; i < url.length; i++) {
                h = ((h << 5) + h + url.charCodeAt(i)) >>> 0;
            }
            return h.toString(36);
        }
        for (const input of [
            'https://sample.fixture.test/sub/abc?protocol=tuic',
            'https://suffix.example/path',
            '',
            'x'.repeat(500),
        ]) {
            assert.equal(djb2Hash(input), legacyHashUrl(input));
        }
    });
});

describe('redactHostname', () => {
    it('emits a prefixed hash containing no pre-image text', () => {
        const out = redactHostname('deep.sample.fixture.test');
        assert.match(out, /^#[0-9a-z]+$/);
        assert.ok(!out.includes('sample'));
    });
});

describe('redactUrl', () => {
    it('drops path and query text entirely', () => {
        const out = redactUrl('https://sample.fixture.test/sub/secret-token?key=abc123');
        assert.ok(!out.includes('secret-token'));
        assert.ok(!out.includes('abc123'));
        assert.ok(!out.includes('key='));
        assert.ok(!out.includes('sample.fixture.test'));
    });

    it('keeps scheme, hashes host/path, flags query presence', () => {
        const out = redactUrl('https://sample.fixture.test/sub/x?y=1');
        assert.match(out, /^https:\/\/#[0-9a-z]+\/…#[0-9a-z]+\?…$/);
        const noQuery = redactUrl('https://sample.fixture.test/sub/x');
        assert.ok(!noQuery.includes('?'));
    });

    it('contains no substring of the input host/path/query', () => {
        const host = 'deep.suffix.example';
        const path = 'p4ssw0rd-like-path';
        const out = redactUrl(`https://${host}/${path}?tok=zzz999`);
        for (const fragment of [host, path, 'zzz999', 'tok']) {
            assert.ok(!out.includes(fragment), `leaked: ${fragment}`);
        }
    });

    it('root path renders as a bare slash', () => {
        assert.match(redactUrl('https://sample.fixture.test/'), /^https:\/\/#[0-9a-z]+\/$/);
    });

    it('unparseable input degrades to a hashed placeholder', () => {
        const out = redactUrl('not a url at all');
        assert.match(out, /^unparseable#[0-9a-z]+$/);
        assert.ok(!out.includes('not a url'));
    });
});
