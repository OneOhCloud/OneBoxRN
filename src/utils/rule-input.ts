// 路由规则编辑器的纯输入辅助函数：对用户输入的 matcher 做归一化、分类与
// 校验，外加批量粘贴解析。
//
// 纯模块：唯一的 import 是类型，运行时被擦除，因此 node 的
// --experimental-strip-types 运行器不需要解析任何原生依赖。

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
        // `::` 至少折叠一个全零组，因此两个显式半段加起来必须留有余地
        // （8 组里最多占 7 组）。
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

/** 去空白并转小写；空白输入折叠为 ""。 */
export function normalizeToken(raw: string): string {
    return raw.trim().toLowerCase();
}

/** 当 `value` 是给定 kind 的合法 matcher 时返回 true。 */
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
 * 按换行和逗号切分粘贴的文本块，对每个 token 归一化，丢弃空白，并在保留
 * 首次出现顺序的前提下去重。
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
