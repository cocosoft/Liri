/**
 * 团队记忆共享目录单向拉取（Phase 1，2026-11-25）单测。
 *
 * 规格：`.trae/specs/team-memory-sync.md` §5（Phase 1）
 * 覆盖：新 id 导入 · 幂等跳过 · 同 id 冲突不覆盖 · 密钥 fail-closed。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildTeamConflictCandidates,
  pullTeamMemoriesFromSharedDir,
  pushTeamMemoriesToSharedDir,
  resolveTeamConflict,
} from '@openliri/infra/memory/services/TeamMemorySharedDirSync';

const createdDirs: string[] = [];

function makeDirs(): { shared: string; local: string } {
  const root = mkdtempSync(join(tmpdir(), 'team-shared-pull-'));
  createdDirs.push(root);
  const shared = join(root, 'shared');
  const local = join(root, 'local');
  mkdirSync(shared, { recursive: true });
  mkdirSync(local, { recursive: true });
  return { shared, local };
}

function memFile(id: string, content: string): string {
  return [
    '---',
    `id: ${id}`,
    `name: ${id}`,
    'type: decision',
    '---',
    '',
    content,
    '',
  ].join('\n');
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (!dir) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

describe('pullTeamMemoriesFromSharedDir（Phase 1）', () => {
  it('远端新 id ⇒ 导入本地；重复拉取幂等', async () => {
    const { shared, local } = makeDirs();
    writeFileSync(join(shared, 'm1.md'), memFile('m1', '团队决策 A'), 'utf-8');

    const first = await pullTeamMemoriesFromSharedDir({
      sharedDir: shared,
      localDir: local,
    });
    expect(first.scanned).toBe(1);
    expect(first.imported).toBe(1);
    expect(existsSync(join(local, 'm1.md'))).toBe(true);

    const second = await pullTeamMemoriesFromSharedDir({
      sharedDir: shared,
      localDir: local,
    });
    expect(second.imported).toBe(0);
    expect(second.skippedIdentical).toBe(1);
  });

  it('同 id 内容不同 ⇒ 只记冲突，不覆盖本地', async () => {
    const { shared, local } = makeDirs();
    writeFileSync(join(shared, 'm2.md'), memFile('m2', '远端版本'), 'utf-8');
    writeFileSync(join(local, 'm2.md'), memFile('m2', '本地版本'), 'utf-8');

    const report = await pullTeamMemoriesFromSharedDir({
      sharedDir: shared,
      localDir: local,
    });

    expect(report.imported).toBe(0);
    expect(report.conflicts).toContain('m2');
    expect(readFileSync(join(local, 'm2.md'), 'utf-8')).toContain('本地版本');
  });

  it('命中密钥 ⇒ 拒收该条（fail-closed），不写入本地', async () => {
    const { shared, local } = makeDirs();
    writeFileSync(
      join(shared, 'm3.md'),
      memFile(
        'm3',
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEexample\n-----END RSA PRIVATE KEY-----'
      ),
      'utf-8'
    );

    const report = await pullTeamMemoriesFromSharedDir({
      sharedDir: shared,
      localDir: local,
    });

    expect(report.rejectedSecrets).toContain('m3');
    expect(report.imported).toBe(0);
    expect(existsSync(join(local, 'm3.md'))).toBe(false);
  });

  it('共享目录不可读 ⇒ 记错误、不抛', async () => {
    const { local } = makeDirs();
    const report = await pullTeamMemoriesFromSharedDir({
      sharedDir: join(local, 'missing'),
      localDir: local,
    });
    expect(report.errors.length).toBeGreaterThan(0);
  });
});

describe('pushTeamMemoriesToSharedDir（Phase 2）', () => {
  it('本地新 id ⇒ 上传；重复推送幂等', async () => {
    const { shared, local } = makeDirs();
    writeFileSync(join(local, 'l1.md'), memFile('l1', '本地团队决策'), 'utf-8');

    const first = await pushTeamMemoriesToSharedDir({
      localDir: local,
      sharedDir: shared,
    });
    expect(first.uploaded).toBe(1);
    expect(existsSync(join(shared, 'l1.md'))).toBe(true);

    const second = await pushTeamMemoriesToSharedDir({
      localDir: local,
      sharedDir: shared,
    });
    expect(second.uploaded).toBe(0);
    expect(second.skippedIdentical).toBe(1);
  });

  it('同 id 内容不同 ⇒ 只记冲突，不覆盖远端', async () => {
    const { shared, local } = makeDirs();
    writeFileSync(join(local, 'l2.md'), memFile('l2', '本地版本'), 'utf-8');
    writeFileSync(join(shared, 'l2.md'), memFile('l2', '远端版本'), 'utf-8');

    const report = await pushTeamMemoriesToSharedDir({
      localDir: local,
      sharedDir: shared,
    });

    expect(report.uploaded).toBe(0);
    expect(report.conflicts).toContain('l2');
    expect(readFileSync(join(shared, 'l2.md'), 'utf-8')).toContain('远端版本');
  });

  it('冲突候选：合并拉/推两向并给出两侧 hash（只读）', async () => {
    const { shared, local } = makeDirs();
    writeFileSync(join(local, 'c1.md'), memFile('c1', '本地版本'), 'utf-8');
    writeFileSync(join(shared, 'c1.md'), memFile('c1', '远端版本'), 'utf-8');
    writeFileSync(join(local, 'c2.md'), memFile('c2', '仅本地'), 'utf-8');

    const candidates = await buildTeamConflictCandidates({
      teamDir: local,
      sharedDir: shared,
      pullConflicts: ['c1'],
      pushConflicts: ['c1', 'c2'],
    });

    expect(candidates.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(candidates[0].directions).toEqual(['pull', 'push']);
    expect(candidates[0].localHash).not.toBe(candidates[0].sharedHash);
    expect(candidates[1].sharedHash).toBeNull();
  });

  it('本地命中密钥 ⇒ 拒发（fail-closed）', async () => {
    const { shared, local } = makeDirs();
    writeFileSync(
      join(local, 'l3.md'),
      memFile(
        'l3',
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEexample\n-----END RSA PRIVATE KEY-----'
      ),
      'utf-8'
    );

    const report = await pushTeamMemoriesToSharedDir({
      localDir: local,
      sharedDir: shared,
    });

    expect(report.rejectedSecrets).toContain('l3');
    expect(report.uploaded).toBe(0);
    expect(existsSync(join(shared, 'l3.md'))).toBe(false);
  });
});

describe('resolveTeamConflict（Phase 3-lite：人工取舍）', () => {
  it('keep_local ⇒ 覆盖共享侧；keep_shared ⇒ 覆盖本地侧', async () => {
    const { shared, local } = makeDirs();
    writeFileSync(join(local, 'r1.md'), memFile('r1', '本地版本'), 'utf-8');
    writeFileSync(join(shared, 'r1.md'), memFile('r1', '远端版本'), 'utf-8');

    expect(
      await resolveTeamConflict({
        id: 'r1',
        teamDir: local,
        sharedDir: shared,
        resolution: 'keep_local',
      })
    ).toBe(true);
    expect(readFileSync(join(shared, 'r1.md'), 'utf-8')).toContain('本地版本');

    writeFileSync(join(shared, 'r1.md'), memFile('r1', '远端版本2'), 'utf-8');
    expect(
      await resolveTeamConflict({
        id: 'r1',
        teamDir: local,
        sharedDir: shared,
        resolution: 'keep_shared',
      })
    ).toBe(true);
    expect(readFileSync(join(local, 'r1.md'), 'utf-8')).toContain('远端版本2');
  });

  it('采纳源命中密钥 ⇒ 拒绝（fail-closed）且两侧不变', async () => {
    const { shared, local } = makeDirs();
    writeFileSync(
      join(local, 'r2.md'),
      memFile(
        'r2',
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEexample\n-----END RSA PRIVATE KEY-----'
      ),
      'utf-8'
    );
    writeFileSync(
      join(shared, 'r2.md'),
      memFile('r2', '远端干净版本'),
      'utf-8'
    );

    const ok = await resolveTeamConflict({
      id: 'r2',
      teamDir: local,
      sharedDir: shared,
      resolution: 'keep_local',
    });

    expect(ok).toBe(false);
    expect(readFileSync(join(shared, 'r2.md'), 'utf-8')).toContain(
      '远端干净版本'
    );
  });

  it('一侧缺失 ⇒ 返回 false', async () => {
    const { shared, local } = makeDirs();
    writeFileSync(join(local, 'r3.md'), memFile('r3', '仅本地'), 'utf-8');
    expect(
      await resolveTeamConflict({
        id: 'r3',
        teamDir: local,
        sharedDir: shared,
        resolution: 'keep_local',
      })
    ).toBe(false);
  });
});
