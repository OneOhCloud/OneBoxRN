import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createNodeStore,
    EMPTY_NODE_STATE,
    INITIAL_LOADING_TIMEOUT_MS,
    reduceGroupUpdate,
    type GroupUpdate,
    type NodeStoreState,
} from './node-store-core.ts';
import { createFakeTimers } from './test-doubles.ts';

const LOADING_STATE: NodeStoreState = { ...EMPTY_NODE_STATE, isLoading: true };

function update(partial?: Partial<GroupUpdate>): GroupUpdate {
    return { all: [], now: '', ...partial };
}

describe('reduceGroupUpdate', () => {
    it('marks delay=0 nodes as testing only inside the window', () => {
        const next = reduceGroupUpdate(
            LOADING_STATE,
            update({ all: [{ tag: 'a', delay: 0 }, { tag: 'b', delay: 42 }] }),
            1_000,
            5_000,
        );
        assert.deepEqual(
            next.nodes.map((n) => [n.tag, n.testing]),
            [['a', true], ['b', false]],
        );
    });

    it('outside the window: no testing flag and loading clears', () => {
        const next = reduceGroupUpdate(
            LOADING_STATE,
            update({ all: [{ tag: 'a', delay: 0 }] }),
            6_000,
            5_000,
        );
        assert.equal(next.nodes[0].testing, false);
        assert.equal(next.isLoading, false);
    });

    it('a measured delay clears loading even inside the window', () => {
        const next = reduceGroupUpdate(
            LOADING_STATE,
            update({ all: [{ tag: 'a', delay: 87 }] }),
            1_000,
            5_000,
        );
        assert.equal(next.isLoading, false);
    });

    it('all-zero delays inside the window keep loading', () => {
        const next = reduceGroupUpdate(
            LOADING_STATE,
            update({ all: [{ tag: 'a', delay: 0 }] }),
            1_000,
            5_000,
        );
        assert.equal(next.isLoading, true);
    });

    it('empty now keeps previous selection; autoNow maps "" to null', () => {
        const prev: NodeStoreState = { ...EMPTY_NODE_STATE, currentNode: 'keep-me' };
        const next = reduceGroupUpdate(prev, update({ autoNow: '' }), 0, 0);
        assert.equal(next.currentNode, 'keep-me');
        assert.equal(next.autoResolvedNode, null);

        const chosen = reduceGroupUpdate(prev, update({ now: 'b', autoNow: 'c' }), 0, 0);
        assert.equal(chosen.currentNode, 'b');
        assert.equal(chosen.autoResolvedNode, 'c');
    });
});

describe('createNodeStore', () => {
    it('beginTestingWindow sets loading and the guard clears it', () => {
        const timers = createFakeTimers();
        let now = 0;
        const store = createNodeStore({ now: () => now, timers: timers.host });

        store.beginTestingWindow();
        assert.equal(store.getSnapshot().isLoading, true);
        assert.deepEqual(timers.pendingDelays(), [INITIAL_LOADING_TIMEOUT_MS]);

        timers.fireAll();
        assert.equal(store.getSnapshot().isLoading, false);
    });

    it('re-arming the window leaves exactly one pending guard', () => {
        const timers = createFakeTimers();
        const store = createNodeStore({ now: () => 0, timers: timers.host });
        store.beginTestingWindow();
        store.beginTestingWindow();
        assert.equal(timers.pendingCount(), 1);
    });

    it('applyGroupUpdate respects the testing window from beginTestingWindow', () => {
        const timers = createFakeTimers();
        let now = 0;
        const store = createNodeStore({ now: () => now, timers: timers.host });
        store.beginTestingWindow(); // window = [0, 12_000)

        now = 1_000;
        store.applyGroupUpdate(update({ all: [{ tag: 'a', delay: 0 }] }));
        assert.equal(store.getSnapshot().nodes[0].testing, true);
        assert.equal(store.getSnapshot().isLoading, true);

        now = 13_000;
        store.applyGroupUpdate(update({ all: [{ tag: 'a', delay: 0 }] }));
        assert.equal(store.getSnapshot().nodes[0].testing, false);
        assert.equal(store.getSnapshot().isLoading, false);
    });

    it('markCurrentNode updates the snapshot and notifies subscribers', () => {
        const store = createNodeStore({ timers: createFakeTimers().host });
        let notified = 0;
        const unsubscribe = store.subscribe(() => {
            notified += 1;
        });
        store.markCurrentNode('node-7');
        assert.equal(store.getSnapshot().currentNode, 'node-7');
        assert.equal(notified, 1);

        unsubscribe();
        store.markCurrentNode('node-8');
        assert.equal(notified, 1);
    });

    it('reset clears state, window and guard timer', () => {
        const timers = createFakeTimers();
        const store = createNodeStore({ now: () => 0, timers: timers.host });
        store.beginTestingWindow();
        store.markCurrentNode('x');
        store.reset();

        assert.deepEqual(store.getSnapshot(), EMPTY_NODE_STATE);
        assert.equal(timers.pendingCount(), 0);

        // Window is closed after reset: delay=0 no longer counts as testing.
        store.applyGroupUpdate(update({ all: [{ tag: 'a', delay: 0 }] }));
        assert.equal(store.getSnapshot().nodes[0].testing, false);
    });
});
