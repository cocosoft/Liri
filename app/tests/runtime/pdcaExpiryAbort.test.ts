// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 审批卡过期 ⇒ 自动中止其 PDCA 任务（2026-11-08，第三十七轮）。
 *
 * 覆盖的是此前**没有测试闭环**的那段接线：
 *   `InboxManager` 过期扫描 → `onInboxItemsExpired` 监听 → `abortPdcaAfterExpiry`
 *   → `getRuntimeCoreApi().getTaskOpsPort().getOrCreatePdcaOrchestrator(taskId)` → `abort()`
 *
 * 背景：PDCA 步骤卡一旦过期就不可回复；若任务不收口，会永久停在
 * `stage_awaiting_approval`（`pendingApproval>0`）并把该会话的幂等键锁死
 * （`findExistingTask` 只排除终态 status）。检查点侧 `abortedBy='user_abort'`
 * 已由 `longRunningRootFix.test.ts` 覆盖，本文件只锁**入口接线与 id 解析**。
 *
 * 隔离：使用**独立 `InboxManager(显式 dbPath)`**（不碰进程单例的真实数据库），
 * 短 TTL（10ms）走**真实调度器**（`startExpireScheduler`）；orchestrator 用替身记录调用，
 * 避免真实 `abort()` 的落库副作用。
 */
import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'pdca-expiry-abort-'));
process.env.LIRI_DATA_DIR = dataDir;

const { InboxManager, onInboxItemsExpired } = await import(
  '@openliri/service/runtime/InboxManager'
);
const { abortPdcaAfterExpiry } = await import(
  '@openliri/service/runtime/inboxApproval'
);
const { registerRuntimeCoreApiProvider } = await import(
  '@openliri/service/runtime/api/coreApiProvider'
);

let manager: InstanceType<typeof InboxManager>;
let offListener: (() => void) | undefined;

afterEach(() => {
  offListener?.();
  offListener = undefined;
  registerRuntimeCoreApiProvider(undefined);
  manager?.dispose();
});

afterAll(() => {
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {
    // Windows：未关闭的 SQLite 连接可能持有目录锁（EBUSY）⇒ 交给系统清理
  }
});

/** 记录被请求中止的任务 id（替身编排器；真实 abort 的落库语义在别处覆盖） */
function stubCoreApi(aborted: string[]): void {
  registerRuntimeCoreApiProvider(() => ({
    getTaskOpsPort: async () =>
      ({
        getOrCreatePdcaOrchestrator: async (taskId: string) => ({
          resumeAfterApproval: async () => ({ phase: 'execute' }),
          abort: async () => {
            aborted.push(taskId);
          },
        }),
      }) as never,
  }));
}

function freshManager(): InstanceType<typeof InboxManager> {
  // 显式路径 ⇒ 不按身份分区、也不会写进程单例的库
  return new InboxManager(
    join(dataDir, `inbox-${Date.now()}-${Math.random()}.db`)
  );
}

async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 4000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('等待条件超时');
}

/** 提交一张审批卡，并用**短 TTL 的真实调度器**把它置为 expired */
async function submitAndExpire(input: {
  sessionId: string;
  source: string;
  metadata: Record<string, unknown>;
}): Promise<{ id: string; status: string }> {
  manager = freshManager();
  const card = await manager.submit({
    sessionId: input.sessionId,
    type: 'approval',
    title: '工具审批: bash',
    message: '命令: node -e 1',
    offlineCapable: true,
    source: input.source,
    metadata: input.metadata,
  });
  // 10ms 过期 + 15ms 扫描（真实调度器路径）
  manager.startExpireScheduler(10, 15);
  await waitFor(async () => (await manager.get(card.id))?.status === 'expired');
  const after = await manager.get(card.id);
  return { id: card.id, status: after?.status ?? 'missing' };
}

describe('审批卡过期 ⇒ 中止 PDCA 任务（短 TTL 集成）', () => {
  it('步骤卡（source=permission + pdcaTaskId）过期 ⇒ abort 对应任务', async () => {
    const aborted: string[] = [];
    stubCoreApi(aborted);
    offListener = onInboxItemsExpired((item) => {
      void abortPdcaAfterExpiry(item);
    });

    const card = await submitAndExpire({
      sessionId: 's-expire-step',
      source: 'permission',
      metadata: { pdcaTaskId: 'pdca_expire_step_1', stepId: 'step_1' },
    });
    expect(card.status).toBe('expired');

    await waitFor(() => aborted.includes('pdca_expire_step_1'));
    expect(aborted).toEqual(['pdca_expire_step_1']);
  });

  it('计划卡（source=pdca + taskId）过期 ⇒ abort 对应任务', async () => {
    const aborted: string[] = [];
    stubCoreApi(aborted);
    offListener = onInboxItemsExpired((item) => {
      void abortPdcaAfterExpiry(item);
    });

    const card = await submitAndExpire({
      sessionId: 's-expire-plan',
      source: 'pdca',
      metadata: { taskId: 'pdca_expire_plan_1', planId: 'plan_1' },
    });
    expect(card.status).toBe('expired');

    await waitFor(() => aborted.includes('pdca_expire_plan_1'));
    expect(aborted).toEqual(['pdca_expire_plan_1']);
  });

  it('无 PDCA 归属的卡过期 ⇒ 不触发任何 abort（负向对照）', async () => {
    const aborted: string[] = [];
    stubCoreApi(aborted);
    offListener = onInboxItemsExpired((item) => {
      void abortPdcaAfterExpiry(item);
    });

    const card = await submitAndExpire({
      sessionId: 's-expire-none',
      source: 'permission',
      metadata: { toolName: 'bash' },
    });
    expect(card.status).toBe('expired');

    // 给监听器一个完成机会，再断言"确实没有"（避免假阴性）
    await new Promise((r) => setTimeout(r, 150));
    expect(aborted).toEqual([]);
  });
});
