/**
 * P3（2026-10-31）：存量会话作用域对齐脚本的守卫。
 *
 * 覆盖四条规则（A 冲突 / B 缺失 / C 模块缺失 / D 形态异常）、预演只读、
 * apply 的备份 + 审计 + 幂等，以及「sessions 目录不可读 ⇒ 拒绝执行」的防御。
 * 口径见 `dev_docs/20261031/会话-项目-模块隔离缺陷与修复方案-20261031.md` §三 P3 与 §七裁定。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  planSessionScopeRepair,
  projectIdFromWorkspacePath,
  repairSessionScope,
} from '../../scripts/repair-session-scope.js';

const PROJ = 'proj_1792989560642_1367c1';
const OTHER_PROJ = 'proj_1793402819293_54c217';
const WT = 'wt-1793076074299-dout54';

let root: string;

function seedSession(
  sessionId: string,
  metadata: Record<string, unknown>,
  partition = '57971aa3'
): string {
  const dir = join(root, 'sessions', partition, sessionId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'session.json');
  writeFileSync(
    file,
    `${JSON.stringify({ id: sessionId, type: 'local', metadata }, null, 2)}\n`,
    'utf-8'
  );
  return file;
}

function readMeta(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf-8')).metadata;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-session-scope-'));
});

afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // Windows 偶发 EBUSY：留给系统清理
  }
});

describe('planSessionScopeRepair（纯函数）', () => {
  it('规则 A：归属与 workspacePath 冲突 ⇒ 按路径归位', () => {
    const plan = planSessionScopeRepair({
      projectId: OTHER_PROJ,
      workspacePath: `C:\\Users\\x\\Documents\\LiriProjects\\${PROJ}`,
    });
    expect(plan?.rules).toEqual(['A', 'C']);
    expect(plan?.after.projectId).toBe(PROJ);
    expect(plan?.after.moduleType).toBe('project');
  });

  it('--prefer=projectId ⇒ 不按路径改写（只补 moduleType）', () => {
    const plan = planSessionScopeRepair(
      {
        projectId: OTHER_PROJ,
        workspacePath: `C:\\Users\\x\\Documents\\LiriProjects\\${PROJ}`,
      },
      { prefer: 'projectId' }
    );
    expect(plan?.rules).toEqual(['C']);
    expect(plan?.after.projectId).toBe(OTHER_PROJ);
  });

  it('规则 B：无归属 + 路径指向 proj_* ⇒ 补写 projectId', () => {
    const plan = planSessionScopeRepair({
      workspacePath: `C:\\Users\\x\\Documents\\LiriProjects\\${PROJ}`,
    });
    expect(plan?.rules).toEqual(['B', 'C']);
    expect(plan?.after.projectId).toBe(PROJ);
    expect(plan?.after.moduleType).toBe('project');
  });

  it('规则 C：无项目归属 ⇒ 归 chat', () => {
    const plan = planSessionScopeRepair({
      workspacePath: 'C:\\Users\\x\\Documents\\notes',
    });
    expect(plan?.rules).toEqual(['C']);
    expect(plan?.after.moduleType).toBe('chat');
  });

  it('规则 D：wt-* 且路径可解析 ⇒ 重写为 proj_*（projectId + workspaceId）', () => {
    const plan = planSessionScopeRepair({
      projectId: WT,
      workspaceId: WT,
      workspacePath: `C:\\Users\\x\\Documents\\LiriProjects\\${PROJ}`,
    });
    expect(plan?.rules).toEqual(['D', 'C']);
    expect(plan?.after.projectId).toBe(PROJ);
    expect(plan?.after.workspaceId).toBe(PROJ);
  });

  it('规则 D：wt-* 且路径不可解析 ⇒ 置空归属并归 chat', () => {
    const plan = planSessionScopeRepair({
      projectId: WT,
      workspaceId: WT,
      workspacePath: 'C:\\Users\\x\\Documents\\notes',
    });
    expect(plan?.rules).toEqual(['D']);
    expect(plan?.after.projectId).toBeUndefined();
    expect(plan?.after.workspaceId).toBeUndefined();
    expect(plan?.after.moduleType).toBe('chat');
  });

  it('已一致 ⇒ 无变更（幂等基础）', () => {
    expect(
      planSessionScopeRepair({
        projectId: PROJ,
        workspaceId: PROJ,
        moduleType: 'project',
        workspacePath: `C:\\Users\\x\\Documents\\LiriProjects\\${PROJ}`,
      })
    ).toBeNull();
  });
});

describe('projectIdFromWorkspacePath', () => {
  it('只认目录名是 proj_* 的路径（含尾斜杠 / 未加引号的反斜杠）', () => {
    expect(projectIdFromWorkspacePath(`C:\\x\\${PROJ}`)).toBe(PROJ);
    expect(projectIdFromWorkspacePath(`C:/x/${PROJ}/`)).toBe(PROJ);
    expect(projectIdFromWorkspacePath('C:\\x\\LiriProjects')).toBeUndefined();
    expect(projectIdFromWorkspacePath(undefined)).toBeUndefined();
  });
});

describe('repairSessionScope（文件系统）', () => {
  it('预演：只报告，不写文件、不建备份目录', () => {
    seedSession('s1', {
      projectId: OTHER_PROJ,
      workspacePath: `C:\\Users\\x\\LiriProjects\\${PROJ}`,
    });
    const result = repairSessionScope({ dataRoot: root, apply: false });

    expect(result.changes).toHaveLength(1);
    expect(result.applied).toBe(0);
    expect(existsSync(join(root, 'migrations'))).toBe(false);
    expect(
      readMeta(join(root, 'sessions', '57971aa3', 's1', 'session.json'))
        .projectId
    ).toBe(OTHER_PROJ);
  });

  it('--apply：写入 metadata、备份原文件、写审计；二次运行 0 变更', () => {
    const file = seedSession('s1', {
      projectId: OTHER_PROJ,
      workspacePath: `C:\\Users\\x\\LiriProjects\\${PROJ}`,
    });
    const result = repairSessionScope({
      dataRoot: root,
      apply: true,
      now: new Date('2026-10-31T08:00:00Z'),
    });

    expect(result.applied).toBe(1);
    const meta = readMeta(file);
    expect(meta.projectId).toBe(PROJ);
    expect(meta.moduleType).toBe('project');
    // 只改 metadata：其它顶层字段原样
    expect(JSON.parse(readFileSync(file, 'utf-8')).type).toBe('local');

    const backupDir = join(root, 'migrations', 'session-scope-20261031T080000');
    const backups = readdirSync(backupDir).filter((f) => f.endsWith('.json'));
    expect(backups).toHaveLength(1);
    const audit = readFileSync(join(backupDir, 'audit.jsonl'), 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(audit[0]).toMatchObject({
      sessionId: 's1',
      rules: ['A', 'C'],
      before: { projectId: OTHER_PROJ },
      after: { projectId: PROJ, moduleType: 'project' },
    });
    expect(audit.at(-1)).toMatchObject({ summary: true, applied: 1 });

    const again = repairSessionScope({ dataRoot: root, apply: true });
    expect(again.changes).toHaveLength(0);
    expect(again.applied).toBe(0);
  });

  it('坏文件：计入 skipped，绝不重写', () => {
    const dir = join(root, 'sessions', '57971aa3', 'broken');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'session.json'), '{ not json', 'utf-8');
    seedSession('ok', { workspacePath: 'C:\\notes' });

    const result = repairSessionScope({ dataRoot: root, apply: true });
    expect(result.skipped).toBe(1);
    expect(result.applied).toBe(1);
    expect(readFileSync(join(dir, 'session.json'), 'utf-8')).toBe('{ not json');
  });

  it('防御：sessions 目录不存在 / 扫不到会话 ⇒ 抛错拒绝执行', () => {
    expect(() => repairSessionScope({ dataRoot: root, apply: true })).toThrow(
      /sessions 目录不可读/
    );

    mkdirSync(join(root, 'sessions', '57971aa3'), { recursive: true });
    expect(() => repairSessionScope({ dataRoot: root, apply: true })).toThrow(
      /未扫描到任何会话/
    );
  });
});
