// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * BR-1（2026-11-19）：用户级记忆文件改为 `~/.pyapp/Liri.md`，并**回退读**旧名 `CLAUDE.md`。
 *
 * 口径（台账 BR-1）：
 *  - 本仓**自有布局**里的 `~/.pyapp/CLAUDE.md` 属品牌残留 ⇒ 新名 `Liri.md`；
 *  - 既有用户文件**零迁移、零丢失**：`Liri.md` 缺失时回退读 `CLAUDE.md`；
 *  - 两者同时存在 ⇒ 只读 `Liri.md`（避免同一内容重复进入记忆上下文）。
 *
 * 项目根下的 `CLAUDE.md`（`scanProjectMemoryFiles`）不属本改动面（用户既有项目约定文件）。
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
} from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const home = mkdtempSync(join(tmpdir(), `memdir-home-${randomUUID()}-`));
const prevHome = process.env.LIRI_HOME;
process.env.LIRI_HOME = home;

const { MemdirService, MemoryLayer } =
  await import('@openliri/infra/memory/memdir/MemdirService');

function resetHome(): void {
  for (const name of ['Liri.md', 'CLAUDE.md']) {
    const p = join(home, name);
    if (existsSync(p)) rmSync(p, { force: true });
  }
  if (!existsSync(home)) mkdirSync(home, { recursive: true });
}

/** 只取**用户级**记忆文件（避开项目根/自动记忆等其它扫描面） */
async function scanUserLayer(): Promise<string[]> {
  const svc = new MemdirService();
  await svc.initialize();
  return svc
    .getMemoryFilesByLayer(MemoryLayer.USER)
    .map((f) => f.path.replace(/\\/g, '/'));
}

beforeEach(resetHome);
afterEach(resetHome);

afterAll(() => {
  if (prevHome === undefined) delete process.env.LIRI_HOME;
  else process.env.LIRI_HOME = prevHome;
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    /* 临时目录清理失败不影响测试结论 */
  }
});

describe('MemdirService 用户级记忆文件：Liri.md 优先 + CLAUDE.md 回退', () => {
  it('仅有旧名 CLAUDE.md ⇒ 仍被读取（既有用户零迁移）', async () => {
    writeFileSync(join(home, 'CLAUDE.md'), '# 旧用户记忆', 'utf-8');
    const paths = await scanUserLayer();
    expect(paths.length).toBe(1);
    expect(paths[0]).toContain('/CLAUDE.md');
  });

  it('仅有新名 Liri.md ⇒ 读取新名', async () => {
    writeFileSync(join(home, 'Liri.md'), '# 新用户记忆', 'utf-8');
    const paths = await scanUserLayer();
    expect(paths.length).toBe(1);
    expect(paths[0]).toContain('/Liri.md');
  });

  it('两者同时存在 ⇒ 只读 Liri.md（不重复入记忆）', async () => {
    writeFileSync(join(home, 'CLAUDE.md'), '# 旧', 'utf-8');
    writeFileSync(join(home, 'Liri.md'), '# 新', 'utf-8');
    const paths = await scanUserLayer();
    expect(paths.length).toBe(1);
    expect(paths[0]).toContain('/Liri.md');
  });

  it('两者都不存在 ⇒ 用户层为空（不造文件）', async () => {
    expect(await scanUserLayer()).toEqual([]);
  });
});
