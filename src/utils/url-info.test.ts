import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveProfileNameFromUrl, getRemoteNameByContentDisposition, urlFilename, urlHostname } from './url-info.ts';

describe('urlHostname', () => {
    it('extracts the hostname', () => {
        assert.equal(urlHostname('https://config.example.invalid/a/b?q=1'), 'config.example.invalid');
    });

    it('returns the fallback on parse failure', () => {
        assert.equal(urlHostname('not a url', 'fb'), 'fb');
        assert.equal(urlHostname('not a url'), '');
    });
});

describe('urlFilename', () => {
    it('returns the decoded last path segment', () => {
        assert.equal(urlFilename('https://x.invalid/raw/abc/appstoreconnect.json'), 'appstoreconnect.json');
        assert.equal(urlFilename('https://x.invalid/a/%E9%85%8D%E7%BD%AE.json'), '配置.json');
    });

    it('returns null for empty paths or unparseable URLs', () => {
        assert.equal(urlFilename('https://x.invalid/'), null);
        assert.equal(urlFilename('nope'), null);
    });

    it('keeps the raw segment when percent-decoding fails', () => {
        assert.equal(urlFilename('https://x.invalid/a/%E0%A4%A'), '%E0%A4%A');
    });
});

describe('deriveProfileNameFromUrl', () => {
    it('prefers the last path segment', () => {
        assert.equal(deriveProfileNameFromUrl('https://config.example.invalid/raw/pro.json'), 'pro.json');
    });

    it('falls back to the hostname when there is no filename segment', () => {
        assert.equal(deriveProfileNameFromUrl('https://config.example.invalid/'), 'config.example.invalid');
    });

    it("falls back to 'Profile' when the URL is unparseable", () => {
        assert.equal(deriveProfileNameFromUrl('not a url'), 'Profile');
    });
});

describe('getRemoteNameByContentDisposition', () => {
    it('parses quoted and bare filenames', () => {
        assert.equal(getRemoteNameByContentDisposition('attachment; filename="pro.json"'), 'pro.json');
        assert.equal(getRemoteNameByContentDisposition('attachment; filename=pro.json'), 'pro.json');
    });

    it('percent-decodes the value', () => {
        assert.equal(getRemoteNameByContentDisposition('attachment; filename=%E9%85%8D%E7%BD%AE'), '配置');
    });

    it('returns null when absent', () => {
        assert.equal(getRemoteNameByContentDisposition(''), null);
        assert.equal(getRemoteNameByContentDisposition('attachment'), null);
    });
});
