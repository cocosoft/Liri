/**
 * X8（2026-09-23，Spec `.trae/specs/goal-entity.md` §5.5）：**主会话用量入账的接线点回归**。
 *
 * `ChatManager.recordChatResponseUsage`（**同步签名，不得改**）在记完请求级用量之后，
 * **fire-and-forget** 地把同一笔 token 记到该会话的未终结目标上（记账与判定解耦：
 * 判定在"下一轮请求前"的既有闸门读库进行，见 `tests/tasks/goal/goalMainSessionWrapUp.test.ts`）。
 *
 * 说明：
 * - 用 `new ChatManagerImpl()` + 私有成员访问（与 `tests/chat/reconcileDrain.test.ts` 同法）；
 * - 本文件只验证"目标用量入账"这一条链路 ⇒ 把该实例的事件追加器换为内存 no-op，
 *   避免在真实用户数据目录写事件（不验证的观测面不产生副作用）；
 * - **等待 fire-and-forget 的手法**：以**库内事实**为判据做有界轮询（`waitFor`），
 *   而不是 `setTimeout(0)` 蒙；超时即判失败（附可读原因）。
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { ChatManagerImpl } from '../../src/chat/ChatManager.js';
import {
  TaskGoalStore,
  setTaskGoalStoreForTest,
} from '../../src/tasks/goal/TaskGoalStore';
import { setGoalEventSink } from '../../src/tasks/goal/GoalEvents';

/** 私有成员访问（TS `private` 仅编译期约束；此处为回归接线行为所必需） */
type ChatManagerInternals = {
  recordChatResponseUsage(
    sessionId: string,
    usage: Record<string, number> | null | undefined,
    requestId?: number
  ): void;
  appendStreamEvent(
    sessionId: string,
    event: unknown
  ): Promise<{ ok: boolean; reason?: string; tailSeq: number }>;
};

const internals = (cm: ChatManagerImpl): ChatManagerInternals =>
  cm as unknown as ChatManagerInternals;

const opened: TaskGoalStore[] = [];
const managers: ChatManagerImpl[] = [];

/**
 * 开库：**内存库**（`:memory:`）—— 无临时文件 ⇒ 无清理负担，也不会在
 * Windows 上撞 sqlite3 句柄异步释放导致的 `EBUSY` 残留。
 */
function makeStore(): TaskGoalStore {
  const store = new TaskGoalStore(':memory:');
  opened.push(store);
  setTaskGoalStoreForTest(store);
  return store;
}

/**
 * 有界轮询：等到 `pred` 为真（或超时）。用于等待 fire-and-forget 落库 ——
 * 判据是**库内事实**，不是固定 sleep。
 *
 * 窗口取 6s：全量套件并发（48+ 文件同进程）时落库可能被调度推迟到秒级，
 * 5s 的默认用例超时会误杀（实测过一次）⇒ 调用方另给用例显式超时（20s）。
 */
async function waitFor(
  pred: () => Promise<boolean>,
  timeoutMs = 6000,
  stepMs = 5
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pred()) return true;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return pred();
}

afterEach(() => {
  setTaskGoalStoreForTest(null);
  setGoalEventSink(null);
  while (managers.length > 0) managers.pop()!.cleanup();
  while (opened.length > 0) opened.pop()!.close();
});

describe('X8：主会话一次响应带 usage ⇒ 该会话未终结目标 tokensUsed 增长', () => {
  test('recordChatResponseUsage → 目标 tokensUsed 累加（fire-and-forget 落库）', async () => {
    const store = makeStore();
    const cm = new ChatManagerImpl();
    managers.push(cm);
    // 观测面隔离：本用例不断言事件落盘，只断言目标用量
    internals(cm).appendStreamEvent = async () => ({ ok: true, tailSeq: 0 });

    const goal = await store.create({
      sessionId: 'sess-acc',
      objective: '主会话记账接线',
      tokenBudget: 10_000,
    });

    internals(cm).recordChatResponseUsage('sess-acc', {
      prompt_tokens: 12,
      completion_tokens: 8,
    });

    const grown = await waitFor(
      async () => ((await store.get(goal.id))?.tokensUsed ?? 0) === 20
    );
    expect(grown).toBe(true);
    expect((await store.get(goal.id))?.tokensUsed).toBe(20);
    expect((await store.get(goal.id))?.status).toBe('active');
  }, 20_000);

  test('只记到本会话的目标上；无目标会话不建行（零影响）', async () => {
    const store = makeStore();
    const cm = new ChatManagerImpl();
    managers.push(cm);
    internals(cm).appendStreamEvent = async () => ({ ok: true, tailSeq: 0 });

    const mine = await store.create({
      sessionId: 'sess-mine',
      objective: '本会话目标',
      tokenBudget: 10_000,
    });
    const other = await store.create({
      sessionId: 'sess-other',
      objective: '别会话目标',
      tokenBudget: 10_000,
    });

    internals(cm).recordChatResponseUsage('sess-mine', {
      prompt_tokens: 5,
      completion_tokens: 5,
    });
    // 正向控制：等到本会话目标确实入账 ⇒ 再断言"别会话不受影响"
    const grown = await waitFor(
      async () => ((await store.get(mine.id))?.tokensUsed ?? 0) === 10
    );
    expect(grown).toBe(true);

    internals(cm).recordChatResponseUsage('sess-none', {
      prompt_tokens: 7,
      completion_tokens: 3,
    });
    // 无目标会话：记一笔后仍不建行（第二次正向控制：本会话再入账一次）
    internals(cm).recordChatResponseUsage('sess-mine', {
      prompt_tokens: 1,
      completion_tokens: 1,
    });
    const grownAgain = await waitFor(
      async () => ((await store.get(mine.id))?.tokensUsed ?? 0) === 12
    );
    expect(grownAgain).toBe(true);

    expect((await store.get(other.id))?.tokensUsed).toBe(0);
    expect(await store.listBySession('sess-none')).toEqual([]);
  }, 20_000);
});
