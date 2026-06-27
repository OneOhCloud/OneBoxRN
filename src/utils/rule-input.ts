// Pure input helpers for the routing-rules editor: normalize, classify and
// validate a user-typed matcher, plus bulk-paste parsing.
//
// Pure module: the only import is a type, erased at runtime, so node's
// --experimental-strip-types runner resolves nothing native.

import type { RuleKind } from '@/database/custom-rules';

const LABEL = /^[a-z0-9-]+$/;

function isIPv4(value: string): boolean {
    const parts = value.split('.');
    if (parts.length !== 4) return false;
    return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function isIPv6(value: string): boolean {
    if (!value.includes(':')) return false;
    const hextet = /^[0-9a-f]{1,4}$/;
    const valid = (groups: string[]) => groups.every((g) => hextet.test(g));

    const halves = value.split('::');
    if (halves.length > 2) return false;

    if (halves.length === 2) {
        const left = halves[0] === '' ? [] : halves[0].split(':');
        const right = halves[1] === '' ? [] : halves[1].split(':');
        if (!valid(left) || !valid(right)) return false;
        // `::` collapses at least one zero group, so the explicit halves
        // together must leave room (≤ 7 of the 8 groups).
        return left.length + right.length <= 7;
    }

    const groups = value.split(':');
    return groups.length === 8 && valid(groups);
}

function isHostname(value: string): boolean {
    if (value === '') return false;
    return value.split('.').every((label) => LABEL.test(label));
}

function isIpCidr(value: string): boolean {
    const slash = value.indexOf('/');
    if (slash === -1) return isIPv4(value) || isIPv6(value);

    const addr = value.slice(0, slash);
    const prefixStr = value.slice(slash + 1);
    if (!/^\d+$/.test(prefixStr)) return false;
    const prefix = Number(prefixStr);

    if (isIPv4(addr)) return prefix >= 0 && prefix <= 32;
    if (isIPv6(addr)) return prefix >= 0 && prefix <= 128;
    return false;
}

/** Trim and lowercase; a blank input collapses to "". */
export function normalizeToken(raw: string): string {
    return raw.trim().toLowerCase();
}

/** True when `value` is a well-formed matcher for the given kind. */
export function validateToken(kind: RuleKind, value: string): boolean {
    switch (kind) {
        case 'domain':
            return isHostname(value);
        case 'domain_suffix':
            return isHostname(value.startsWith('.') ? value.slice(1) : value);
        case 'ip_cidr':
            return isIpCidr(value);
    }
}

/**
 * Split a pasted blob on newlines AND commas, normalize each token, drop
 * blanks, and dedupe while preserving first-seen order.
 */
export function parseBulkInput(text: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const token of text.split(/[\n,]+/).map(normalizeToken)) {
        if (token === '' || seen.has(token)) continue;
        seen.add(token);
        out.push(token);
    }
    return out;
}
