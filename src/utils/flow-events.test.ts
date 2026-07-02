import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatFlowEvent, newFlowId, type FlowEvent } from './flow-events.ts';

describe('newFlowId', () => {
    it('is 8 base36 chars', () => {
        assert.match(newFlowId(), /^[0-9a-z]{8}$/);
    });

    it('is unique across 1000 calls at a frozen clock', () => {
        const ids = new Set<string>();
        for (let i = 0; i < 1000; i++) ids.add(newFlowId(1_700_000_000_000));
        assert.equal(ids.size, 1000);
    });
});

describe('formatFlowEvent', () => {
    const base: FlowEvent = {
        event: 'config_import',
        flowId: 'ab12cd34',
        status: 'fail',
        phase: 'download',
        errorCode: 'TIMEOUT',
        durationMs: 1234,
    };

    it('starts with the [EVT] prefix and event/flow first', () => {
        const line = formatFlowEvent(base);
        assert.ok(line.startsWith('[EVT] event=config_import flow=ab12cd34 '));
    });

    it('uses stable key order', () => {
        const line = formatFlowEvent(base);
        assert.equal(
            line,
            '[EVT] event=config_import flow=ab12cd34 phase=download status=fail durationMs=1234 errorCode=TIMEOUT',
        );
    });

    it('omits undefined fields', () => {
        const line = formatFlowEvent({ event: 'vpn_toggle', flowId: 'x1y2z3w4', status: 'ok' });
        assert.equal(line, '[EVT] event=vpn_toggle flow=x1y2z3w4 status=ok');
    });

    it('is greppable by flow=<id>', () => {
        const line = formatFlowEvent(base);
        assert.ok(line.includes(' flow=ab12cd34'));
    });
});
