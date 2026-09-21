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
import { unlinkSync } from 'fs';
import {
  AgentRunStore,
  setAgentRunStoreForTest,
} from '../src/tools/AgentTool/AgentRunStore';

const dbPath = join(tmpdir(), `agent-runs-test-${process.pid}.db`);

try {
  const store = new AgentRunStore(dbPath);
  await store.init();
  setAgentRunStoreForTest(store);

  // 进程退出时回收临时库（测试进程结束即无价值）
  process.on('exit', () => {
    try {
      store.close();
    } catch {
      // @ignore-catch: 退出路径，关闭失败无补救价值
    }
    try {
      unlinkSync(dbPath);
    } catch {
      // @ignore-catch: 临时文件可能未创建或已被清理
    }
  });
} catch (err) {
  // 注入失败不阻断测试：退回原行为（写生产台账）只影响隔离性，不影响断言正确性。
  // 用 stderr 直写（测试 setup 不引入项目 Logger，避免额外初始化链）。
  process.stderr.write(
    `[test-setup] AgentRunStore 隔离失败，将回退为默认单例：${String(err)}\n`
  );
}
