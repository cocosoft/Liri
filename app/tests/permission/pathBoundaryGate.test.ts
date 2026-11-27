/**
 * D4（2026-11-27）：文件类工具的**路径硬闸**（写类一期 + 读类二期）。
 *
 * 判据（都在权限层，simulate 与真实执行同源）：
 * 1. 写类工具写向受保护路径（`security/files/ProtectedPaths` 的清单）⇒ **deny**，五档一致（含 bypass）；
 * 2. 写类工具写向工作区外 ⇒ **ask**，仅 `default` / `auto`（`plan` 本已每步询问，`dontAsk`/`bypass` 语义是不询问）；
 * 3. 读类工具读向**凭据 / 密钥面**（`~/.ssh` / `~/.aws` / `/etc/shadow` …）⇒ **deny**，五档一致；
 *    读 shell rc、`/etc/hosts` 等系统配置文件不拦（常见调试动作），也不对读做越界 ask。
 *
 * 立论：内容级规则是用户自写正则，不能当边界保证；此前文件类工具只有"规则/档位"，
 * 一条误配 allow 就能写进 `~/.ssh` / `/etc` / Windows SAM 这类位置、或把本地凭据读给模型。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PermissionManager } from '@openliri/infra/permission/PermissionManager';
import type { PermissionMode } from '@openliri/infra/permission/PermissionMode';
import {
  evaluateOutOfWorkspaceWrite,
  evaluateProtectedReadPath,
  evaluateProtectedWritePath,
} from '@openliri/infra/permission/guards/pathBoundary';
import type { ToolPermissionResult } from '@openliri/infra/permission/manager/toolPermission';
import {
  PermissionBehavior,
  PermissionRuleSource,
  createPermissionRule,
} from '@openliri/infra/permission/types/PermissionRule';

type Decision = 'allow' | 'ask' | 'deny';

function toDecision(result: ToolPermissionResult): Decision {
  if (result.allowed) return 'allow';
  return result.decision?.behavior === 'ask' ? 'ask' : 'deny';
}

/** 受保护文件（跨平台清单里的家目录项，必然存在且不受工作区影响） */
const PROTECTED = join(homedir(), '.bashrc');

describe('D4 判定单元：evaluateProtectedWritePath', () => {
  it('写类工具 + 受保护路径 ⇒ 命中', () => {
    const hit = evaluateProtectedWritePath('file_write', {
      file_path: PROTECTED,
      content: 'x',
    });
    expect(hit).not.toBeNull();
    expect(hit?.path.toLowerCase()).toContain('.bashrc');
  });

  it('非写类工具 / 普通路径 ⇒ 不命中（零行为变更）', () => {
    expect(
      evaluateProtectedWritePath('file_read', { file_path: PROTECTED })
    ).toBeNull();
    expect(
      evaluateProtectedWritePath('file_write', {
        file_path: join(tmpdir(), 'normal.txt'),
        content: 'x',
      })
    ).toBeNull();
  });
});

describe('D4 判定单元：生成类工具的输出路径同样过写闸（2026-11-27 补覆盖）', () => {
  it('pdf / image / video 写受保护目录 ⇒ 命中', () => {
    expect(
      evaluateProtectedWritePath('pdf', {
        filepath: join(homedir(), '.ssh', 'x.pdf'),
      })
    ).not.toBeNull();
    expect(
      evaluateProtectedWritePath('image', {
        outputPath: join(homedir(), '.aws', 'x.png'),
      })
    ).not.toBeNull();
    expect(
      evaluateProtectedWritePath('video', {
        outputPath: join(homedir(), '.kube', 'x.mp4'),
      })
    ).not.toBeNull();
  });

  it('普通输出目录 / 非写类工具 ⇒ 不命中（零行为变更）', () => {
    expect(
      evaluateProtectedWritePath('image', {
        outputPath: join(tmpdir(), 'ok.png'),
      })
    ).toBeNull();
    expect(
      evaluateProtectedWritePath('web_fetch', {
        outputPath: join(homedir(), '.ssh'),
      })
    ).toBeNull();
  });

  it('notebook 的 path（create/save/export 落点）同样过写闸', () => {
    expect(
      evaluateProtectedWritePath('notebook', {
        action: 'save',
        path: join(homedir(), '.ssh', 'x.ipynb'),
      })
    ).not.toBeNull();
    expect(
      evaluateProtectedWritePath('notebook', {
        action: 'save',
        path: join(tmpdir(), 'ok.ipynb'),
      })
    ).toBeNull();
  });
});

describe('D4 判定单元：evaluateOutOfWorkspaceWrite', () => {
  const ws = join(tmpdir(), 'd4-ws');

  it('工作区外 ⇒ 命中；界内 ⇒ 不命中', () => {
    expect(
      evaluateOutOfWorkspaceWrite(
        'file_write',
        { file_path: join(tmpdir(), 'out.txt') },
        [ws]
      )
    ).not.toBeNull();
    expect(
      evaluateOutOfWorkspaceWrite(
        'file_write',
        { file_path: join(ws, 'in.txt') },
        [ws]
      )
    ).toBeNull();
  });

  it('相对路径按工作区根解析（`in.txt` 视为界内）', () => {
    expect(
      evaluateOutOfWorkspaceWrite('file_write', { file_path: 'in.txt' }, [ws])
    ).toBeNull();
  });

  it('未给工作区根 ⇒ 不判定（不误报 ask）', () => {
    expect(
      evaluateOutOfWorkspaceWrite(
        'file_write',
        { file_path: join(tmpdir(), 'out.txt') },
        []
      )
    ).toBeNull();
  });

  it('受保护路径不算"越界 ask"（由 deny 闸负责）', () => {
    expect(
      evaluateOutOfWorkspaceWrite('file_write', { file_path: PROTECTED }, [ws])
    ).toBeNull();
  });
});

describe('D4 二期判定单元：evaluateProtectedReadPath', () => {
  const CREDENTIAL = join(homedir(), '.ssh', 'id_rsa');

  it('读类工具 + 凭据路径 ⇒ 命中', () => {
    const hit = evaluateProtectedReadPath('file_read', {
      file_path: CREDENTIAL,
    });
    expect(hit).not.toBeNull();
    expect(hit?.path.toLowerCase()).toContain('.ssh');
    expect(hit?.reason).toContain('读取被拒绝');
  });

  it('`~` 前缀与 `target` 键同样判定（grep / code_analysis 口径）', () => {
    expect(
      evaluateProtectedReadPath('grep', { path: '~/.aws/credentials' })
    ).not.toBeNull();
    expect(
      evaluateProtectedReadPath('code_analysis', { target: '~/.kube/config' })
    ).not.toBeNull();
  });

  it('读系统配置文件（shell rc / normal）⇒ 不命中（读闸只到凭据面）', () => {
    expect(
      evaluateProtectedReadPath('file_read', { file_path: PROTECTED })
    ).toBeNull();
    expect(
      evaluateProtectedReadPath('file_read', {
        file_path: join(tmpdir(), 'normal.txt'),
      })
    ).toBeNull();
  });

  it('非读类工具 ⇒ 不命中（写闸/其他工具零行为变更）', () => {
    expect(
      evaluateProtectedReadPath('file_write', { file_path: CREDENTIAL })
    ).toBeNull();
    expect(
      evaluateProtectedReadPath('task_output', { path: CREDENTIAL })
    ).toBeNull();
  });

  it('`lsp` 按给定文件读内容 ⇒ 同受读闸约束（2026-11-27 补覆盖）', () => {
    expect(
      evaluateProtectedReadPath('lsp', { file_path: CREDENTIAL })
    ).not.toBeNull();
    expect(
      evaluateProtectedReadPath('lsp', {
        file_path: join(tmpdir(), 'normal.ts'),
      })
    ).toBeNull();
  });

  it('读不做越界判定（跨工作区读取是常态，不误报 ask）', () => {
    expect(
      evaluateOutOfWorkspaceWrite(
        'file_read',
        { file_path: join(tmpdir(), 'outside.txt') },
        [join(tmpdir(), 'ws')]
      )
    ).toBeNull();
  });
});

describe('D4 集成：五档一致 + simulate 同源', () => {
  let dir: string;
  let manager: PermissionManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'liri-d4-'));
    manager = new PermissionManager();
    manager.getRuleManager().setRuleSource(join(dir, 'tool_rules.json'));
    manager.getRuleManager().loadRules();
    manager.setToolPermissionContext({
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeProtected = { file_path: PROTECTED, content: 'x' };
  const modes: PermissionMode[] = [
    'default',
    'auto',
    'plan',
    'dontAsk',
    'bypass',
  ];

  for (const mode of modes) {
    it(`${mode} 档：写受保护路径 ⇒ deny（地板不随档位放宽）`, async () => {
      manager.setMode(mode);
      const result = await manager.checkPermissionForTool(
        'file_write',
        writeProtected
      );
      expect(toDecision(result)).toBe('deny');
    });

    it(`${mode} 档：读凭据路径 ⇒ deny（读闸同为地板）`, async () => {
      manager.setMode(mode);
      const result = await manager.checkPermissionForTool('file_read', {
        file_path: join(homedir(), '.ssh', 'id_rsa'),
      });
      expect(toDecision(result)).toBe('deny');
    });
  }

  it('default 档：显式工具级 allow 不能越过读闸', async () => {
    manager.setMode('default');
    manager.getRuleManager().addRule(
      createPermissionRule({
        behavior: PermissionBehavior.ALLOW,
        toolName: 'file_read',
        source: PermissionRuleSource.RULE_STORE,
      })
    );
    const input = { file_path: join(homedir(), '.ssh', 'id_rsa') };

    const executed = await manager.checkPermissionForTool('file_read', input);
    const simulated = await manager.simulatePermission({
      toolName: 'file_read',
      input,
      mode: 'default',
    });

    expect(toDecision(executed)).toBe('deny');
    expect(simulated.decision).toBe('deny');
  });

  it('bypass 档：生成类工具写受保护路径 ⇒ deny（地板不随档位放宽）', async () => {
    manager.setMode('bypass');
    const result = await manager.checkPermissionForTool('image', {
      outputPath: join(homedir(), '.ssh', 'x.png'),
    });
    expect(toDecision(result)).toBe('deny');
  });

  it('default 档：工作区外写入 ⇒ ask（不是静默放行）', async () => {
    manager.setMode('default');
    const result = await manager.checkPermissionForTool(
      'file_write',
      { file_path: join(tmpdir(), 'outside.txt'), content: 'x' },
      { workspaceRoots: [join(dir, 'ws')] }
    );
    expect(toDecision(result)).toBe('ask');
  });

  it('default 档：工作区内写入 ⇒ allow（正常流程不被拦截）', async () => {
    const ws = join(dir, 'ws');
    manager.setMode('default');
    const result = await manager.checkPermissionForTool(
      'file_write',
      { file_path: join(ws, 'in.txt'), content: 'x' },
      { workspaceRoots: [ws] }
    );
    expect(toDecision(result)).toBe('allow');
  });

  it('显式工具级 allow 规则不能越过受保护路径地板', async () => {
    manager.setMode('default');
    manager.getRuleManager().addRule(
      createPermissionRule({
        behavior: PermissionBehavior.ALLOW,
        toolName: 'file_write',
        source: PermissionRuleSource.RULE_STORE,
      })
    );

    const executed = await manager.checkPermissionForTool(
      'file_write',
      writeProtected
    );
    const simulated = await manager.simulatePermission({
      toolName: 'file_write',
      input: writeProtected,
      mode: 'default',
    });

    expect(toDecision(executed)).toBe('deny');
    expect(simulated.decision).toBe('deny');
  });

  it('simulate 与真实执行对"工作区外 ⇒ ask"同结论', async () => {
    manager.setMode('default');
    const input = { file_path: join(tmpdir(), 'outside.txt'), content: 'x' };
    const roots = [join(dir, 'ws')];

    const simulated = await manager.simulatePermission({
      toolName: 'file_write',
      input,
      mode: 'default',
      workspaceRoots: roots,
    });
    const executed = await manager.checkPermissionForTool('file_write', input, {
      workspaceRoots: roots,
    });

    expect(simulated.decision).toBe('ask');
    expect(toDecision(executed)).toBe('ask');
  });
});
