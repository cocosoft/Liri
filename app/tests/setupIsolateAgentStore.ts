/**
 * 测试全局隔离：把 `AgentRunStore` 单例重定向到临时 DB（台账 N-46）
 *
 * **为什么需要**：`AgentTool.execute()` → `beginRun()` → `getAgentRunStore().startRun()`
 * 走的是**全局单例**，其 DB 路径来自 `resolveDbPath()`（生产 `~/.pyapp/data/app.db`），
 * 而调用 `agentTool.execute()` 的单元测试只注入了 fake 引擎 / fake 解析器 ——
 * **落盘这一段写的是真实生产存储**。实测：跑一次 `agentDelegationGrant.test.ts`
 * 后真机 `GET /v1/agents/runs` 的 total 由 50 → 52，且前端
 * 「Agent 角色 → 运行态」面板会把这些测试行当作真实运行记录展示。
 *
 * **生效方式**：由 `app/bunfig.toml` 的 `[test].preload` 加载，在全部测试文件之前执行。
 * 放在 preload 而非逐个测试文件，是为了让**将来新增**的 AgentTool 测试自动继承隔离。
 */
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, readdirSync, statSync } from 'fs';
import {
  AgentRunStore,
  setAgentRunStoreForTest,
} from '../src/tools/AgentTool/AgentRunStore';

const dbPath = join(tmpdir(), `agent-runs-test-${process.pid}.db`);

/**
 * 兜底清扫：删除**上一轮遗留**的同前缀临时库（2026-09-23 预存债务修复）。
 *
 * **为什么需要**：`bun test` 的 worker 进程终止时**不一定运行 `process.on('exit')`**
 * ——实测 hook 已注册但 `agent-runs-test-<pid>.db`(+`-wal`+`-shm`) 仍逐轮残留
 *（同一段代码在裸 Bun 进程下可正常回收，已用最小探针确认）。
 * 只删 **mtime 超过 1 小时** 的同前缀文件 ⇒ 不会误删并发 worker 正在使用的库。
 */
function sweepStaleTestDbs(): void {
  const staleMs = 60 * 60 * 1000;
  const now = Date.now();
  try {
    for (const name of readdirSync(tmpdir())) {
      if (!name.startsWith('agent-runs-test-')) continue;
      const full = join(tmpdir(), name);
      try {
        if (now - statSync(full).mtimeMs < staleMs) continue;
        unlinkSync(full);
      } catch {
        // @ignore-catch: 单文件清扫失败不影响测试
      }
    }
  } catch {
    // @ignore-catch: 临时目录不可读时跳过清扫
  }
}

sweepStaleTestDbs();

try {
  const store = new AgentRunStore(dbPath);
  await store.init();
  setAgentRunStoreForTest(store);

  // 进程退出时回收临时库（测试进程结束即无价值）。
  // `exit` 与 `beforeExit` **都注册**：前者覆盖显式退出，后者在事件循环耗尽时更早触发
  //（worker 被强杀时二者都可能不执行 ⇒ 由上方的陈旧清扫兜底）。
  let cleaned = false;
  const cleanupOnce = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      store.close();
    } catch {
      // @ignore-catch: 退出路径，关闭失败无补救价值
    }
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      try {
        unlinkSync(f);
      } catch {
        // @ignore-catch: 临时文件可能未创建或已被清理
      }
    }
  };
  process.on('exit', cleanupOnce);
  process.on('beforeExit', cleanupOnce);
} catch (err) {
  // 注入失败不阻断测试：退回原行为（写生产台账）只影响隔离性，不影响断言正确性。
  // 用 stderr 直写（测试 setup 不引入项目 Logger，避免额外初始化链）。
  process.stderr.write(
    `[test-setup] AgentRunStore 隔离失败，将回退为默认单例：${String(err)}\n`
  );
}
