// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * §12.15（2026-10-23）：`write_project_file` 的**隔离路由**接线级回归。
 *
 * 断言三件事：
 * ① 项目 sandbox 已挂载进容器时，写盘落在适配器（宿主 `node:fs` 不参与）；
 * ② 目录创建与写后回读都走端口（`mkdir` / `statSize` ⇒ `ws.execute`）；
 * ③ `resolveFileIoRoot()` 返回项目 sandbox 根（供沙箱豁免 S4b 校验"已挂载"）。
 *
 * 环境隔离：用 `LIRI_DATA_DIR` 把项目库指向临时目录（工具内部按 `resolveDataDir()` 取）。
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DOCKER_CONFIG_KEYS } from '../../src/sandbox/docker/index.js';
import { SandboxPlatform } from '../../src/sandbox/SandboxTypes.js';
import { globalWorkspaceManager } from '../../src/sandbox/WorkspaceManager.js';
import {
  resolveFileIoToolModeHint,
  resolveSandboxExecutionSignal,
} from '../../src/sandbox/index.js';
import { RuleManager } from '../../src/permission/RuleManager.js';
import { PermissionChecker } from '../../src/permission/PermissionChecker.js';
import { PermissionDecisionType } from '../../src/permission/types/PermissionDecision.js';
import { createProjectStore } from '../../src/workspace/ProjectStore.js';
import { WorkItemStore } from '../../src/workspace/WorkItemStore.js';
import { WriteProjectFileTool } from '../../src/tools/WriteProjectFileTool/WriteProjectFileTool.js';
import { ToolLazyWrapper } from '../../src/tools/utils/ToolLazyWrapper.js';
import type { LazyModuleLoader } from '@openliri/kernel';
import type { Tool } from '../../src/tools/types/Tool.js';

const dataDir = mkdtempSync(join(tmpdir(), 'liri-wpf-iso-'));
const hostWorkspace = join(dataDir, 'ws');
const sandboxPath = join(dataDir, 'projects', 'p1', 'sandbox');
let previousDataDir: string | undefined;

const written = new Map<string, string>();
const mkdirs: string[] = [];

beforeAll(() => {
  previousDataDir = process.env.LIRI_DATA_DIR;
  process.env.LIRI_DATA_DIR = dataDir;

  const store = createProjectStore(
    dataDir,
    new WorkItemStore(dataDir) as never
  );
  store.create({
    id: 'p1',
    workspaceId: 'ws-1',
    name: 'P1',
    sandboxPath,
  });

  const ws = globalWorkspaceManager.createSync('default', {
    platform: SandboxPlatform.LINUX,
    workingDirectory: hostWorkspace,
    customConfig: {
      [DOCKER_CONFIG_KEYS.VOLUMES]: [
        { hostPath: sandboxPath, containerPath: '/project-p1', mode: 'rw' },
      ],
    },
  });

  ws.readFile = async (p: string) => {
    const value = written.get(p);
    if (value === undefined) throw new Error(`ENOENT: ${p}`);
    return value;
  };
  ws.writeFile = async (p: string, content: string) => {
    written.set(p, content);
  };
  // mkdir / statSize 经 `ws.execute`（容器内命令）；此处按命令前缀模拟
  ws.execute = (async (command: string) => {
    if (command.startsWith('mkdir')) {
      mkdirs.push(command);
      return {
        success: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        executionTime: 0,
      };
    }
    if (command.startsWith('stat')) {
      const match = /'(.+)'/.exec(command);
      const target = match?.[1];
      const content = target ? written.get(target) : undefined;
      const bytes =
        content === undefined ? NaN : Buffer.byteLength(content, 'utf-8');
      return {
        success: Number.isFinite(bytes),
        exitCode: Number.isFinite(bytes) ? 0 : 1,
        stdout: Number.isFinite(bytes) ? String(bytes) : '',
        stderr: Number.isFinite(bytes) ? '' : `${command} => missing`,
        executionTime: 0,
      };
    }
    return {
      success: false,
      exitCode: 1,
      stdout: '',
      stderr: 'unknown',
      executionTime: 0,
    };
  }) as never;
});

afterAll(async () => {
  if (globalWorkspaceManager.has('default')) {
    await globalWorkspaceManager.close('default');
  }
  if (previousDataDir === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = previousDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('§12.15 write_project_file：项目 sandbox 已挂载 ⇒ 写入经适配器', () => {
  it('写盘落 /project-p1，宿主 sandbox 不产生文件；目录与大小校验走端口', async () => {
    const tool = WriteProjectFileTool.create();

    const result = await tool.execute(
      { projectId: 'p1', relativePath: 'note.txt', content: 'hello' },
      {} as never
    );

    expect(written.get('/project-p1/note.txt')).toBe('hello');
    expect(existsSync(join(sandboxPath, 'note.txt'))).toBe(false);
    expect(mkdirs.some((cmd) => cmd.includes("'/project-p1'"))).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('resolveFileIoRoot 返回项目 sandbox 根（S4b 依据）', () => {
    const tool = WriteProjectFileTool.create();
    expect(tool.resolveFileIoRoot?.({ projectId: 'p1' })).toBe(sandboxPath);
    expect(tool.resolveFileIoRoot?.({})).toBeUndefined();
  });
});

/**
 * §12.15 第 5 条：**接线级负向回归** —— 项目 sandbox 未被挂载时，
 * 即便容器工作区已隔离、工具也已声明 `file-io`，也不得因沙箱而免审批。
 */
describe('§12.15 write_project_file：S4b 端到端（挂载与否决定豁免）', () => {
  async function mountWorkspace(
    volumes: Array<{
      hostPath: string;
      containerPath: string;
      mode: 'rw' | 'ro';
    }>
  ) {
    if (globalWorkspaceManager.has('default')) {
      await globalWorkspaceManager.close('default');
    }
    return globalWorkspaceManager.createSync('default', {
      platform: SandboxPlatform.LINUX,
      workingDirectory: hostWorkspace,
      customConfig: { [DOCKER_CONFIG_KEYS.VOLUMES]: volumes },
    });
  }

  /**
   * §12.18：生产链路里注册表存的是 `ToolLazyWrapper` ⇒ 用**同构包装器**验证
   * "工具的 `sandboxLevel` / `riskClass` / `resolveFileIoRoot` 声明能到达权限层"。
   * （修复前：包装器不透传 ⇒ 风险判 `undeclared`、`targetRoot` 恒空、S4b 失效。）
   */
  function wrapLazy(tool: Tool): Tool {
    const loader = {
      isLoaded: () => false,
      getSync: () => tool,
      get: async () => tool,
      loadSync: () => tool,
      reset: () => undefined,
    } as unknown as LazyModuleLoader<Tool>;
    return new ToolLazyWrapper(tool.getInfo(), loader);
  }

  function decide(wrapInLazy = false) {
    const real = WriteProjectFileTool.create();
    const tool = wrapInLazy ? wrapLazy(real) : real;
    const input = { projectId: 'p1', relativePath: 'x.txt', content: 'x' };
    const signal = resolveSandboxExecutionSignal({
      enabled: true,
      landlockEnabled: false,
      platform: 'win32',
      permissionLevel: 'standard',
      modeHint: resolveFileIoToolModeHint(tool.sandboxLevel),
    });
    const checker = new PermissionChecker(new RuleManager());
    return {
      tool,
      signal,
      decision: checker.checkPermission(tool as never, input, {
        toolName: 'write_project_file',
        input,
        sessionId: 's-1',
        sandbox: signal,
        workspacePath: hostWorkspace,
      } as never),
    };
  }

  it('只挂工作区、未挂项目 sandbox ⇒ ask（target-root-not-mounted）', async () => {
    await mountWorkspace([
      { hostPath: hostWorkspace, containerPath: '/workspace', mode: 'rw' },
    ]);
    const { signal, decision } = decide();
    expect(signal.mode).toBe('container');
    expect(signal.fileIoIsolated).toBe(true);
    expect(signal.fileIoRoots).toEqual([hostWorkspace]);

    const result = await decision;
    expect(result.type).toBe(PermissionDecisionType.ASK);
  });

  it('项目 sandbox 也挂载 ⇒ allow（豁免全前提满足）', async () => {
    await mountWorkspace([
      { hostPath: hostWorkspace, containerPath: '/workspace', mode: 'rw' },
      { hostPath: sandboxPath, containerPath: '/project-p1', mode: 'rw' },
    ]);
    const { signal, decision } = decide();
    expect(signal.fileIoRoots).toContain(sandboxPath);

    const result = await decision;
    expect(result.type).toBe(PermissionDecisionType.ALLOW);
  });

  it('生产链路（经懒加载包装器）：未挂项目 sandbox ⇒ 仍 ask', async () => {
    await mountWorkspace([
      { hostPath: hostWorkspace, containerPath: '/workspace', mode: 'rw' },
    ]);
    const { tool, signal, decision } = decide(true);
    // 声明经包装器可见（修复前 `sandboxLevel` / `riskClass` 均丢失）
    expect(tool.sandboxLevel).toBe('file-io');
    expect(signal.mode).toBe('container');

    const result = await decision;
    expect(result.type).toBe(PermissionDecisionType.ASK);
  });

  it('生产链路（经懒加载包装器）：项目 sandbox 已挂载 ⇒ allow', async () => {
    await mountWorkspace([
      { hostPath: hostWorkspace, containerPath: '/workspace', mode: 'rw' },
      { hostPath: sandboxPath, containerPath: '/project-p1', mode: 'rw' },
    ]);
    const { tool, signal, decision } = decide(true);
    expect(tool.sandboxLevel).toBe('file-io');
    expect(signal.fileIoRoots).toContain(sandboxPath);

    const result = await decision;
    expect(result.type).toBe(PermissionDecisionType.ALLOW);
  });
});
