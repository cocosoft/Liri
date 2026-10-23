// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 方案 A（2026-10-23）：文件类工具「经沙箱执行」的判定与路由回归。
 *
 * 覆盖三件事：
 * ① 宿主路径 → 隔离环境路径的映射（越界/前缀陷阱必须 `null`，不许"猜"）；
 * ② `fileIoMount()` 的取证口径：**没有 `rw` 挂载就没有映射**（容器临时层不算隔离）；
 * ③ 接线级：默认工作区是"容器 + 挂载"时，`file_write` 的写盘落在**适配器**上，
 *    宿主 `node:fs` 不参与（此前那种"声明 file-io 后宿主直写"的假隔离必须被这条挡住）。
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  toIsolatedPath,
  findMountForPath,
} from '../../src/sandbox/isolationPathMap.js';
import { DockerWorkspace } from '../../src/sandbox/adapters/DockerWorkspace.js';
import {
  hasIsolatedFileIo,
  resolveFileIoExecutionMode,
  resolveWorkspaceFileIo,
} from '../../src/sandbox/workspaceIsolation.js';
import {
  resolveFileIoToolModeHint,
  resolveSandboxExecutionSignal,
} from '../../src/sandbox/sandboxExecutionSignal.js';
import { resolveSandboxExemption } from '../../src/permission/sandboxExemption.js';
import { RiskClass } from '../../src/permission/types/RiskClass.js';
import {
  SandboxPlatform,
  SandboxPermission,
  type SandboxConfig,
} from '../../src/sandbox/SandboxTypes.js';
import { DOCKER_CONFIG_KEYS } from '../../src/sandbox/docker/index.js';
import { globalWorkspaceManager } from '../../src/sandbox/WorkspaceManager.js';
import { FileWriteTool } from '../../src/tools/FileWriteTool/FileWriteTool.js';

function config(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
  return {
    platform: SandboxPlatform.LINUX,
    allowedPermissions: [
      SandboxPermission.READ_FILE,
      SandboxPermission.WRITE_FILE,
    ],
    filesystemWhitelist: [],
    networkWhitelist: [],
    environmentWhitelist: [],
    maxExecutionTime: 30000,
    maxMemory: 256,
    workingDirectory: '/host/ws',
    ...overrides,
  };
}

describe('方案 A：宿主路径 → 隔离环境路径', () => {
  const map = { hostRoot: '/host/ws', isolatedRoot: '/workspace' };

  it('工作区内的文件按相对位置映射', () => {
    expect(toIsolatedPath(map, '/host/ws/a/b.txt')).toBe('/workspace/a/b.txt');
  });

  it('工作区根本身映射为环境内根', () => {
    expect(toIsolatedPath(map, '/host/ws')).toBe('/workspace');
  });

  it('Windows 分隔符与反斜杠混用同样可映射', () => {
    expect(
      toIsolatedPath(
        { hostRoot: 'E:\\ws', isolatedRoot: '/workspace' },
        'E:\\ws\\a.txt'
      )
    ).toBe('/workspace/a.txt');
  });

  it('越界 ⇒ null（不许"猜"到容器里）', () => {
    expect(toIsolatedPath(map, '/host/other/a.txt')).toBeNull();
  });

  it('前缀相似的兄弟目录 ⇒ null（`/host/ws2` 不是 `/host/ws`）', () => {
    expect(toIsolatedPath(map, '/host/ws2/a.txt')).toBeNull();
  });

  it('§12.15 多挂载：命中多条时取**最长前缀**（项目 sandbox 在会话工作区内）', () => {
    const mounts = [
      { hostRoot: '/host/ws', isolatedRoot: '/workspace' },
      { hostRoot: '/host/ws/projects/p1', isolatedRoot: '/project-p1' },
    ];
    expect(findMountForPath(mounts, '/host/ws/a.txt')?.isolatedRoot).toBe(
      '/workspace'
    );
    expect(
      findMountForPath(mounts, '/host/ws/projects/p1/out.md')?.isolatedRoot
    ).toBe('/project-p1');
    expect(findMountForPath(mounts, '/host/other/a.txt')).toBeNull();
  });
});

describe('方案 A：fileIoMount 取证口径', () => {
  it('无挂载 ⇒ null（容器临时层写进去宿主也看不见）', () => {
    const ws = new DockerWorkspace(config());
    expect(ws.fileIoMount()).toBeNull();
  });

  it('rw 挂载指向工作区根 ⇒ 给出映射', () => {
    const ws = new DockerWorkspace(
      config({
        customConfig: {
          [DOCKER_CONFIG_KEYS.VOLUMES]: [
            { hostPath: '/host/ws', containerPath: '/workspace', mode: 'rw' },
          ],
        },
      })
    );
    expect(ws.fileIoMount()).toEqual({
      hostRoot: '/host/ws',
      isolatedRoot: '/workspace',
    });
  });

  it('只读挂载 ⇒ null（写不进去，不能声称文件 IO 隔离）', () => {
    const ws = new DockerWorkspace(
      config({
        customConfig: {
          [DOCKER_CONFIG_KEYS.VOLUMES]: [
            { hostPath: '/host/ws', containerPath: '/workspace', mode: 'ro' },
          ],
        },
      })
    );
    expect(ws.fileIoMount()).toBeNull();
  });

  it('挂载的不是工作区根 ⇒ null', () => {
    const ws = new DockerWorkspace(
      config({
        customConfig: {
          [DOCKER_CONFIG_KEYS.VOLUMES]: [
            {
              hostPath: '/host/elsewhere',
              containerPath: '/workspace',
              mode: 'rw',
            },
          ],
        },
      })
    );
    expect(ws.fileIoMount()).toBeNull();
  });

  it('§12.15 多挂载：fileIoMounts 取全部 rw 挂载；fileIoMount 只认工作区根', () => {
    const ws = new DockerWorkspace(
      config({
        customConfig: {
          [DOCKER_CONFIG_KEYS.VOLUMES]: [
            { hostPath: '/host/ws', containerPath: '/workspace', mode: 'rw' },
            {
              hostPath: '/data/projects/p1',
              containerPath: '/project-p1',
              mode: 'rw',
            },
            { hostPath: '/host/ro', containerPath: '/ro', mode: 'ro' },
          ],
        },
      })
    );
    expect(ws.fileIoMounts()).toEqual([
      { hostRoot: '/host/ws', isolatedRoot: '/workspace' },
      { hostRoot: '/data/projects/p1', isolatedRoot: '/project-p1' },
    ]);
    expect(ws.fileIoMount()).toEqual({
      hostRoot: '/host/ws',
      isolatedRoot: '/workspace',
    });
  });
});

describe('方案 A：默认工作区 → 文件 IO 端口', () => {
  let hostDir = '';

  afterEach(async () => {
    if (globalWorkspaceManager.has('default')) {
      await globalWorkspaceManager.close('default');
    }
    if (hostDir && existsSync(hostDir)) {
      rmSync(hostDir, { recursive: true, force: true });
      hostDir = '';
    }
  });

  it('本地工作区（宿主 fs）⇒ 端口为 null，不声称隔离', () => {
    hostDir = mkdtempSync(join(tmpdir(), 'liri-a-local-'));
    globalWorkspaceManager.createSync('default', {
      platform: SandboxPlatform.WINDOWS,
      workingDirectory: hostDir,
    });

    expect(resolveWorkspaceFileIo()).toBeNull();
    expect(hasIsolatedFileIo()).toBe(false);
    // 本地工作区 ⇒ 文件类工具不给 modeHint（保持 fail-closed）
    expect(resolveFileIoExecutionMode()).toBeUndefined();
    expect(resolveFileIoToolModeHint('file-io')).toBeUndefined();
  });

  it('容器但**无挂载映射** ⇒ 不声称隔离，也不给 modeHint', () => {
    hostDir = mkdtempSync(join(tmpdir(), 'liri-a-nomount-'));
    globalWorkspaceManager.createSync('default', {
      platform: SandboxPlatform.LINUX,
      workingDirectory: hostDir,
    });

    expect(hasIsolatedFileIo()).toBe(false);
    expect(resolveFileIoExecutionMode()).toBeUndefined();
    expect(resolveFileIoToolModeHint('file-io')).toBeUndefined();
  });

  it('容器工作区 + rw 挂载 ⇒ 端口可用，且能把宿主路径翻译到容器内', () => {
    hostDir = mkdtempSync(join(tmpdir(), 'liri-a-docker-'));
    globalWorkspaceManager.createSync('default', {
      platform: SandboxPlatform.LINUX,
      workingDirectory: hostDir,
      customConfig: {
        [DOCKER_CONFIG_KEYS.VOLUMES]: [
          { hostPath: hostDir, containerPath: '/workspace', mode: 'rw' },
        ],
      },
    });

    expect(hasIsolatedFileIo()).toBe(true);
    const io = resolveWorkspaceFileIo();
    expect(io?.mode).toBe('container');
    expect(io?.toIsolatedPath(join(hostDir, 'note.md'))).toBe(
      '/workspace/note.md'
    );

    // 文件类工具的 modeHint 如实上报容器；非文件类工具不给（执行仍在宿主/Landlock）
    expect(resolveFileIoExecutionMode()).toBe('container');
    expect(resolveFileIoToolModeHint('file-io')).toBe('container');
    expect(resolveFileIoToolModeHint('execution')).toBeUndefined();
    expect(resolveFileIoToolModeHint(undefined)).toBeUndefined();
  });

  it('接线：容器工作区下 file_write 的写盘落在适配器，宿主 fs 不参与', async () => {
    hostDir = mkdtempSync(join(tmpdir(), 'liri-a-route-'));
    const ws = globalWorkspaceManager.createSync('default', {
      platform: SandboxPlatform.LINUX,
      workingDirectory: hostDir,
      customConfig: {
        [DOCKER_CONFIG_KEYS.VOLUMES]: [
          { hostPath: hostDir, containerPath: '/workspace', mode: 'rw' },
        ],
      },
    });

    const written = new Map<string, string>();
    ws.readFile = async (p: string) => {
      const value = written.get(p);
      if (value === undefined) throw new Error(`ENOENT: ${p}`);
      return value;
    };
    ws.writeFile = async (p: string, content: string) => {
      written.set(p, content);
    };

    const res = await new FileWriteTool().execute(
      { file_path: 'note.md', content: 'hello' },
      { options: { cwd: hostDir } } as never
    );

    expect(written.get('/workspace/note.md')).toBe('hello');
    expect(existsSync(join(hostDir, 'note.md'))).toBe(false);
    // 回执仍是**宿主路径**（模型据此复述位置，前端出站路由也认它）
    expect(String(res.data)).toContain(join(hostDir, 'note.md'));
  });

  it('端到端：容器工作区 ⇒ 信号自带 container + fileIoIsolated ⇒ 写工具获沙箱豁免', () => {
    hostDir = mkdtempSync(join(tmpdir(), 'liri-a-e2e-'));
    globalWorkspaceManager.createSync('default', {
      platform: SandboxPlatform.LINUX,
      workingDirectory: hostDir,
      customConfig: {
        [DOCKER_CONFIG_KEYS.VOLUMES]: [
          { hostPath: hostDir, containerPath: '/workspace', mode: 'rw' },
        ],
      },
    });

    // 与 chat 入口同口径：信号 = 缺省推导 + 文件类工具的 modeHint
    const signal = resolveSandboxExecutionSignal({
      enabled: true,
      landlockEnabled: false,
      platform: 'win32',
      permissionLevel: 'standard',
      modeHint: resolveFileIoToolModeHint('file-io'),
    });
    expect(signal).toEqual({
      mode: 'container',
      permissionLevel: 'standard',
      fileIoIsolated: true,
      fileIoRoots: [hostDir],
    });

    expect(
      resolveSandboxExemption({
        signal,
        risk: RiskClass.WRITE_LOCAL,
        sandboxLevel: 'file-io',
        input: { file_path: join(hostDir, 'a.md') },
        workspacePath: hostDir,
      })
    ).toEqual({ exempt: true, reason: 'sandbox-isolated' });
  });

  it('端到端对照：本地工作区 ⇒ 信号仍 none，声明 file-io 也不豁免', () => {
    hostDir = mkdtempSync(join(tmpdir(), 'liri-a-e2e-local-'));
    globalWorkspaceManager.createSync('default', {
      platform: SandboxPlatform.WINDOWS,
      workingDirectory: hostDir,
    });

    const signal = resolveSandboxExecutionSignal({
      enabled: true,
      landlockEnabled: false,
      platform: 'win32',
      permissionLevel: 'standard',
      modeHint: resolveFileIoToolModeHint('file-io'),
    });
    expect(signal.mode).toBe('none');
    expect(signal.fileIoIsolated).toBe(false);

    expect(
      resolveSandboxExemption({
        signal,
        risk: RiskClass.WRITE_LOCAL,
        sandboxLevel: 'file-io',
        input: { file_path: join(hostDir, 'a.md') },
        workspacePath: hostDir,
      })
    ).toEqual({ exempt: false, reason: 'no-isolation' });
  });
});
