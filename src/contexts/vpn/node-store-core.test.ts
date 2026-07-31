import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createNodeStore,
    EMPTY_NODE_STATE,
    INITIAL_LOADING_TIMEOUT_MS,
    isNodeTestStale,
    NODE_TEST_STALE_MS,
    reduceGroupUpdate,
    TESTING_WINDOW_MS,
    type GroupUpdate,
    type NodeStoreState,
} from './node-store-core.ts';
import { createFakeTimers } from './test-doubles.ts';

const LOADING_STATE: NodeStoreState = { ...EMPTY_NODE_STATE, isLoading: true };

function update(partial?: Partial<GroupUpdate>): GroupUpdate {
    return { all: [], now: '', autoNow: '', ...partial };
}

/** delay>0 时补一个稳定的成功时间戳，与原生「无样本 ⇔ 两者皆 0」语义一致。 */
function node(tag: string, delay: number, urlTestTime?: number): GroupUpdate['all'][number] {
    return { tag, delay, urlTestTime: urlTestTime ?? (delay > 0 ? 1_700_000_000 : 0) };
}

describe('reduceGroupUpdate', () => {
    it('marks delay=0 nodes as testing only inside the window', () => {
        const next = reduceGroupUpdate(
            LOADING_STATE,
            update({ all: [node('a', 0), node('b', 42)] }),
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
            update({ all: [node('a', 0)] }),
            6_000,
            5_000,
        );
        assert.equal(next.nodes[0].testing, false);
        assert.equal(next.isLoading, false);
    });

    it('a measured delay clears loading even inside the window', () => {
        const next = reduceGroupUpdate(
            LOADING_STATE,
            update({ all: [node('a', 87)] }),
            1_000,
            5_000,
        );
        assert.equal(next.isLoading, false);
    });

    it('all-zero delays inside the window keep loading', () => {
        const next = reduceGroupUpdate(
            LOADING_STATE,
            update({ all: [node('a', 0)] }),
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

    it('maps urlTestTime (unix seconds) to lastTestAt (ms); 0 stays 0', () => {
        const next = reduceGroupUpdate(
            EMPTY_NODE_STATE,
            update({ all: [node('a', 80, 1_700_000_000), node('b', 0, 0)] }),
            0,
            0,
        );
        assert.equal(next.nodes[0].lastTestAt, 1_700_000_000_000);
        assert.equal(next.nodes[1].lastTestAt, 0);
    });

    it('derives stale from the event-apply clock; no-sample nodes are never stale', () => {
        const testedAtSec = 1_700_000_000;
        const testedAtMs = testedAtSec * 1000;
        const next = reduceGroupUpdate(
            EMPTY_NODE_STATE,
            update({ all: [node('fresh', 80, testedAtSec), node('old', 90, testedAtSec), node('none', 0, 0)] }),
            0,
            0,
        );
        // nowMs=0 < 阈值 → 均不陈旧
        assert.deepEqual(next.nodes.map((n) => n.stale), [false, false, false]);

        const later = reduceGroupUpdate(
            EMPTY_NODE_STATE,
            update({ all: [node('old', 90, testedAtSec), node('none', 0, 0)] }),
            testedAtMs + NODE_TEST_STALE_MS,
            0,
        );
        assert.deepEqual(later.nodes.map((n) => n.stale), [true, false]);
    });

    it('isSweeping survives inside the window and dies outside it', () => {
        const sweeping: NodeStoreState = { ...EMPTY_NODE_STATE, isSweeping: true };
        assert.equal(reduceGroupUpdate(sweeping, update(), 1_000, 5_000).isSweeping, true);
        assert.equal(reduceGroupUpdate(sweeping, update(), 6_000, 5_000).isSweeping, false);
    });
});

describe('isNodeTestStale', () => {
    it('no sample (0) is never stale — it renders as a dash instead', () => {
        assert.equal(isNodeTestStale(0, NODE_TEST_STALE_MS * 10), false);
    });

    it('flips exactly at the threshold', () => {
        const testedAt = 1_000_000;
        assert.equal(isNodeTestStale(testedAt, testedAt + NODE_TEST_STALE_MS - 1), false);
        assert.equal(isNodeTestStale(testedAt, testedAt + NODE_TEST_STALE_MS), true);
    });
});

describe('createNodeStore', () => {
    it('beginTestingWindow sets loading+sweeping and arms both guards', () => {
        const timers = createFakeTimers();
        const store = createNodeStore({ now: () => 0, timers: timers.host });

        store.beginTestingWindow();
        assert.equal(store.getSnapshot().isLoading, true);
        assert.equal(store.getSnapshot().isSweeping, true);
        assert.deepEqual(timers.pendingDelays(), [INITIAL_LOADING_TIMEOUT_MS, TESTING_WINDOW_MS]);
    });

    it('the loading guard clears only isLoading; the window guard clears the rest', () => {
        const timers = createFakeTimers();
        let now = 0;
        const store = createNodeStore({ now: () => now, timers: timers.host });
        store.beginTestingWindow();

        now = 1_000;
        store.applyGroupUpdate(update({ all: [node('a', 0)] }));
        assert.equal(store.getSnapshot().nodes[0].testing, true);

        timers.fireNext(); // 8s loading guard
        assert.equal(store.getSnapshot().isLoading, false);
        assert.equal(store.getSnapshot().nodes[0].testing, true);
        assert.equal(store.getSnapshot().isSweeping, true);

        timers.fireNext(); // 12s window guard
        assert.equal(store.getSnapshot().nodes[0].testing, false);
        assert.equal(store.getSnapshot().isSweeping, false);
        assert.equal(timers.pendingCount(), 0);
    });

    it('re-arming the window leaves exactly one pending guard pair', () => {
        const timers = createFakeTimers();
        const store = createNodeStore({ now: () => 0, timers: timers.host });
        store.beginTestingWindow();
        store.beginTestingWindow();
        assert.equal(timers.pendingCount(), 2);
    });

    it('applyGroupUpdate respects the testing window from beginTestingWindow', () => {
        const timers = createFakeTimers();
        let now = 0;
        const store = createNodeStore({ now: () => now, timers: timers.host });
        store.beginTestingWindow(); // 窗口 = [0, 12_000)

        now = 1_000;
        store.applyGroupUpdate(update({ all: [node('a', 0)] }));
        assert.equal(store.getSnapshot().nodes[0].testing, true);
        assert.equal(store.getSnapshot().isLoading, true);

        now = 13_000;
        store.applyGroupUpdate(update({ all: [node('a', 0)] }));
        assert.equal(store.getSnapshot().nodes[0].testing, false);
        assert.equal(store.getSnapshot().isLoading, false);
    });

    it('a frozen testing node is force-cleared when the window guard fires (no further events)', () => {
        // 机制性回归锁：探测失败会删除内核历史 → 不再有 group 事件到达 →
        // 此前该节点会永久转圈。窗口到期必须无条件收口。
        const timers = createFakeTimers();
        let now = 0;
        const store = createNodeStore({ now: () => now, timers: timers.host });
        store.beginTestingWindow();

        now = 11_900;
        store.applyGroupUpdate(update({ all: [node('usable-but-failed-probe', 0)] }));
        assert.equal(store.getSnapshot().nodes[0].testing, true);

        timers.fireAll(); // 之后再无任何事件
        assert.equal(store.getSnapshot().nodes[0].testing, false);
        assert.equal(store.getSnapshot().isLoading, false);
        assert.equal(store.getSnapshot().isSweeping, false);
    });

    it('cancelTestingWindow closes the window immediately and disarms guards', () => {
        const timers = createFakeTimers();
        let now = 0;
        const store = createNodeStore({ now: () => now, timers: timers.host });
        store.beginTestingWindow();

        now = 500;
        store.applyGroupUpdate(update({ all: [node('a', 0)] }));
        store.cancelTestingWindow();

        assert.equal(store.getSnapshot().nodes[0].testing, false);
        assert.equal(store.getSnapshot().isLoading, false);
        assert.equal(store.getSnapshot().isSweeping, false);
        assert.equal(timers.pendingCount(), 0);

        // 关窗后到达的迟到事件不再把 delay=0 标记为 testing。
        now = 1_000;
        store.applyGroupUpdate(update({ all: [node('a', 0)] }));
        assert.equal(store.getSnapshot().nodes[0].testing, false);
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

    it('reset clears state, window and guard timers', () => {
        const timers = createFakeTimers();
        const store = createNodeStore({ now: () => 0, timers: timers.host });
        store.beginTestingWindow();
        store.markCurrentNode('x');
        store.reset();

        assert.deepEqual(store.getSnapshot(), EMPTY_NODE_STATE);
        assert.equal(timers.pendingCount(), 0);

        // reset 后窗口关闭：delay=0 不再算作 testing。
        store.applyGroupUpdate(update({ all: [node('a', 0)] }));
        assert.equal(store.getSnapshot().nodes[0].testing, false);
    });
});
