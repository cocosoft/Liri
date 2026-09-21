/**
 * AgentRoleStore 测试（多 agent 协作方案 O11-2）
 *
 * 锁定三件事：
 * 1. 播种判据 = "表是否为空"（与启用位无关）—— 修复"全部禁用后重启 ⇒ 重复播种 ⇒
 *    `agent_id UNIQUE` 冲突被 `.catch()` 吞掉、仅剩启动日志一条 error"的静默故障；
 * 2. `model` 列可写可读（insert / update / getByAgentId）；
 * 3. 老库（`model` 列新增前创建）经 `ensureColumns()` **幂等补齐**，不丢既有结构。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import { Database } from '@modules/core/external/sqlite3';
import { AgentRoleStore } from '../../src/workspace/AgentRoleStore';

const createdPaths: string[] = [];

function makeDbPath(): string {
  const path = join(tmpdir(), `agent-roles-${randomUUID().slice(0, 8)}.db`);
  createdPaths.push(path);
  return path;
}

afterEach(() => {
  while (createdPaths.length > 0) {
    const path = createdPaths.pop()!;
    try {
      unlinkSync(path);
    } catch {
      // @ignore-catch — 清理临时文件失败不影响断言
    }
  }
});

/** 建一个"旧结构"库（无 model 列），模拟本列新增前已存在的库 */
async function createLegacyDb(path: string): Promise<void> {
  const db = await new Promise<Database>((resolve, reject) => {
    const opened = new Database(path, (err: Error | null) =>
      err ? reject(err) : resolve(opened)
    );
  });
  await new Promise<void>((resolve, reject) => {
    db.run(
      `CREATE TABLE agent_roles (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        expertise TEXT NOT NULL DEFAULT '[]',
        weight REAL NOT NULL DEFAULT 1.0,
        system_prompt TEXT NOT NULL DEFAULT '',
        icon TEXT NOT NULL DEFAULT '🤖',
        sort_order INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )`,
      (err: Error | null) => (err ? reject(err) : resolve())
    );
  });
  db.close();
}

describe('AgentRoleStore：播种判据（O11-2）', () => {
  test('空库 init ⇒ 播种 5 个默认角色', async () => {
    const store = new AgentRoleStore(makeDbPath());
    await store.init();

    const roles = await store.listAll();
    expect(roles).toHaveLength(5);
    expect(await store.listEnabled()).toHaveLength(5);
    store.close();
  });

  test('全部禁用后**再次 init**（模拟重启）⇒ 不重复播种、不抛错', async () => {
    const path = makeDbPath();
    const first = new AgentRoleStore(path);
    await first.init();

    const roles = await first.listAll();
    for (const role of roles) {
      await first.update(role.id!, { enabled: false });
    }
    expect(await first.listEnabled()).toHaveLength(0);
    first.close();

    // 重启：旧实现按 `WHERE enabled = 1` 判空 ⇒ 重新播种 ⇒ agent_id UNIQUE 冲突
    const second = new AgentRoleStore(path);
    await second.init().catch((err) => {
      throw new Error(`重启初始化不应抛错：${String(err)}`);
    });

    expect(await second.listAll()).toHaveLength(5); // 未新增
    expect(await second.listEnabled()).toHaveLength(0); // 禁用位被保留
    second.close();
  });
});

describe('AgentRoleStore：model 列（O11-2）', () => {
  test('insert / update / getByAgentId 支持 model', async () => {
    const store = new AgentRoleStore(makeDbPath());
    await store.init();

    await store.insert({
      agentId: 'custom-role',
      name: '自定义角色',
      expertise: [],
      weight: 1,
      systemPrompt: 'SP',
      model: 'model-a',
      icon: '🤖',
      sortOrder: 9,
      enabled: true,
    });

    const inserted = await store.getByAgentId('custom-role');
    expect(inserted?.model).toBe('model-a');

    await store.update(inserted!.id!, { model: 'model-b' });
    expect((await store.getByAgentId('custom-role'))?.model).toBe('model-b');

    // 未设置 model 的默认角色 ⇒ undefined（不写空串）
    const seeded = await store.getByAgentId('architect');
    expect(seeded?.model).toBeUndefined();
    store.close();
  });

  test('老库（无 model 列）⇒ ensureColumns 幂等补齐，读写正常', async () => {
    const path = makeDbPath();
    await createLegacyDb(path);

    const store = new AgentRoleStore(path);
    await store.init();

    const roles = await store.listAll();
    expect(roles).toHaveLength(5); // 旧库为空 ⇒ 正常播种

    const target = await store.getByAgentId('architect');
    await store.update(target!.id!, { model: 'legacy-upgraded' });
    expect((await store.getByAgentId('architect'))?.model).toBe(
      'legacy-upgraded'
    );

    // 再次 init（幂等）：重复补列不应抛错
    const reopened = new AgentRoleStore(path);
    await reopened.init();
    expect((await reopened.getByAgentId('architect'))?.model).toBe(
      'legacy-upgraded'
    );
    store.close();
    reopened.close();
  });
});

describe('AgentRoleStore：agentId 大小写归一（O16）', () => {
  /** 构造一条完整角色配置（`agentId` 由用例给定） */
  function roleConfig(agentId: string) {
    return {
      agentId,
      name: agentId,
      expertise: ['测试'],
      weight: 1.0,
      systemPrompt: `prompt:${agentId}`,
      icon: '🤖',
      sortOrder: 0,
      enabled: true,
    };
  }

  test('写入侧归一：管理页填 `CodeReview` ⇒ 入库为 `codereview`，三种大小写均可命中', async () => {
    const store = new AgentRoleStore(makeDbPath());
    await store.init();

    await store.insert(roleConfig('CodeReview'));

    expect((await store.getByAgentId('codereview'))?.agentId).toBe('codereview');
    expect((await store.getByAgentId('CodeReview'))?.agentId).toBe('codereview');
    expect((await store.getByAgentId('CODEREVIEW'))?.agentId).toBe('codereview');
    // 入库值本身已归一（不依赖查询侧补救）
    const all = await store.listAll();
    expect(all.some((r) => r.agentId === 'codereview')).toBe(true);
    expect(all.some((r) => r.agentId === 'CodeReview')).toBe(false);
    store.close();
  });

  test('首尾空白一并归一（`"  Plan-X  "` ⇒ `plan-x`）', async () => {
    const store = new AgentRoleStore(makeDbPath());
    await store.init();

    await store.insert(roleConfig('  Plan-X  '));

    expect((await store.getByAgentId('plan-x'))?.agentId).toBe('plan-x');
    expect((await store.getByAgentId(' PLAN-X '))?.agentId).toBe('plan-x');
    store.close();
  });

  test('update 改 `agentId` 亦是写入 ⇒ 同样归一', async () => {
    const store = new AgentRoleStore(makeDbPath());
    await store.init();

    const id = await store.insert(roleConfig('rename-me'));
    await store.update(id, { agentId: 'RENAMED' });

    expect(await store.getByAgentId('rename-me')).toBeNull();
    expect((await store.getByAgentId('renamed'))?.agentId).toBe('renamed');
    store.close();
  });
});

describe('AgentRoleStore：委派授权位（T9）', () => {
  test('canDelegate 可写可读；缺省 = false（fail-closed）；update 未提交则保持原值', async () => {
    const store = new AgentRoleStore(makeDbPath());
    await store.init();

    // 播种角色无授权 ⇒ false
    expect((await store.getByAgentId('architect'))?.canDelegate).toBe(false);

    await store.insert({
      agentId: 'delegator',
      name: '委派者',
      expertise: ['编排'],
      weight: 1.0,
      systemPrompt: 'x',
      icon: '🧭',
      sortOrder: 9,
      enabled: true,
      canDelegate: true,
    });
    expect((await store.getByAgentId('delegator'))?.canDelegate).toBe(true);

    const target = await store.getByAgentId('delegator');
    await store.update(target!.id!, { name: '委派者2' });
    expect((await store.getByAgentId('delegator'))?.canDelegate).toBe(true);

    await store.update(target!.id!, { canDelegate: false });
    expect((await store.getByAgentId('delegator'))?.canDelegate).toBe(false);

    store.close();
  });

  test('老库（无 can_delegate 列）⇒ 幂等补列，默认 false 且可启用', async () => {
    const path = makeDbPath();
    await createLegacyDb(path);

    const store = new AgentRoleStore(path);
    await store.init();

    expect((await store.getByAgentId('architect'))?.canDelegate).toBe(false);
    const target = await store.getByAgentId('architect');
    await store.update(target!.id!, { canDelegate: true });
    expect((await store.getByAgentId('architect'))?.canDelegate).toBe(true);

    store.close();
  });
});

describe('AgentRoleStore：解析链三态取数（T7）', () => {
  test('命中 / 被禁用 / 不存在 三态可分辨，且与 listEnabled 的集合形态一致', async () => {
    const store = new AgentRoleStore(makeDbPath());
    await store.init();

    // 播种的 architect 默认启用 ⇒ ok
    const hit = await store.resolveForDelegation('architect');
    expect(hit.state).toBe('ok');
    if (hit.state === 'ok') {
      expect(hit.role.agentId).toBe('architect');
    }

    // 禁用后 ⇒ disabled（**不是** missing：两者文案不同，见 O11-1）
    const target = await store.getByAgentId('architect');
    await store.update(target!.id!, { enabled: false });
    expect((await store.resolveForDelegation('ARCHITECT')).state).toBe(
      'disabled'
    );

    // 不存在 ⇒ missing
    expect((await store.resolveForDelegation('no-such-role')).state).toBe(
      'missing'
    );

    // 双消费者语义一致：禁用后不再出现在启用集里
    const enabled = await store.listEnabled();
    expect(enabled.some((r) => r.agentId === 'architect')).toBe(false);

    store.close();
  });
});
