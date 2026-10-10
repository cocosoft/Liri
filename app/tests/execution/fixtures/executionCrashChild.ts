/**
 * P0-1 进程级崩溃注入 —— **子进程夹具**（`.trae/specs/process-crash-injection.md` §3.1）。
 *
 * 用法：`bun executionCrashChild.ts <dbPath> <scenario>`
 *
 * 行为：按场景 seed 出"崩溃前"的持久化状态（executions / tool_calls），**打印 `SEEDED`** 后
 * 用 **SIGKILL 终止自身** —— 不执行 `finally`、不 `close()`、不触发任何退出钩子，
 * 以此模拟**真实进程崩溃**（区别于进程内 `spyOn` + 抛错）。
 *
 * 该夹具**只写真实 SQLite 文件**（`ExecutionStore` 公共 API），不 mock 任何存储。
 */

import { ExecutionStore } from '../../../src/execution/ExecutionStore.js';
import type {
  ExecutionGeneration,
  ExecutionId,
} from '../../../src/execution/types.js';

const [, , dbPath, scenario] = process.argv;
const eid = (s: string): ExecutionId => s as ExecutionId;
const gen = (n: number): ExecutionGeneration => n as ExecutionGeneration;

/** 固定"陈旧"心跳（10 分钟前）⇒ 恢复时判定为孤儿（与 `DEFAULT_EXEC_HEARTBEAT_STALE_MS` 无关，显式传入 staleMs） */
const STALE_AT = Date.now() - 10 * 60 * 1000;

async function seed(store: ExecutionStore, scenario: string): Promise<void> {
  switch (scenario) {
    // ① 工具调用记录**尚未落盘**（写前崩溃）
    case 'before-ledger-write':
      await store.upsertExecution({
        executionId: eid('c-before'),
        sessionId: 's-before',
        messageId: 'm-before',
        generation: gen(1),
        status: 'RUNNING',
        startedAt: STALE_AT,
        updatedAt: STALE_AT,
        heartbeatAt: STALE_AT,
      });
      break;

    // ② 工具调用**已落盘**且仍 `running`（副作用是否发生不可知）
    case 'after-ledger-write':
      await store.upsertExecution({
        executionId: eid('c-after'),
        sessionId: 's-after',
        messageId: 'm-after',
        generation: gen(2),
        status: 'RUNNING',
        startedAt: STALE_AT,
        updatedAt: STALE_AT,
        heartbeatAt: STALE_AT,
      });
      await store.recordToolCall(eid('c-after'), 'tc-after', 'file_write');
      break;

    // ⑤ 状态已是 `CANCEL_REQUESTED`（取消在途）但底层进程随崩溃消失
    case 'cancel-requested':
      await store.upsertExecution({
        executionId: eid('c-cancel'),
        sessionId: 's-cancel',
        messageId: 'm-cancel',
        generation: gen(3),
        status: 'CANCEL_REQUESTED',
        startedAt: STALE_AT,
        updatedAt: STALE_AT,
        heartbeatAt: STALE_AT,
      });
      await store.recordToolCall(eid('c-cancel'), 'tc-cancel', 'bash');
      break;

    // ④ 为 fencing「迟到提交」准备：代次 7 的孤儿
    case 'orphan-for-fencing':
      await store.upsertExecution({
        executionId: eid('c-fence'),
        sessionId: 's-fence',
        messageId: 'm-fence',
        generation: gen(7),
        status: 'RUNNING',
        startedAt: STALE_AT,
        updatedAt: STALE_AT,
        heartbeatAt: STALE_AT,
      });
      break;

    default:
      process.stderr.write(`unknown scenario: ${scenario}\n`);
      process.exit(2);
  }
}

const store = new ExecutionStore(dbPath);
void seed(store, scenario ?? '').then(() => {
  // 落盘完成后**真实崩溃**（SIGKILL：无 finally / 无退出钩子 / 不 close 连接）
  process.stdout.write('SEEDED\n');
  process.kill(process.pid, 'SIGKILL');
});
