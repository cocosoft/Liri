/**
 * 本地工作空间适配器
 * 使用 Node.js fs 模块直接操作本地文件系统
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

import {
  WorkspaceBase,
  WorkspaceFileInfo,
  WorkspaceListResult,
} from '../WorkspaceBase';
import {
  SandboxConfig,
  SandboxExecuteOptions,
  SandboxExecuteResult,
} from '../SandboxTypes';

import { handleError } from '@openliri/infra/error';
// G1-沙箱（2026-11-03）：宿主 spawn 前的 cwd 判定（与 BashTool / 各工具链同一实现）
import { describeUnusableSpawnCwd } from '@openliri/infra/utils/cwd';

import { getLogger } from '@openliri/infra/monitoring';
const logger = getLogger('sandbox:adapters:LocalWorkspace');

const execAsync = promisify(exec);

/**
 * 本地工作空间适配器
 * 使用本地文件系统和 child_process 实现
 */
export class LocalWorkspace extends WorkspaceBase {
  private readonly workingDir: string;

  constructor(config: SandboxConfig) {
    super(config);
    this.workingDir = config.workingDirectory || process.cwd();
  }

  /**
   * 读取本地文件
   */
  async readFile(filePath: string): Promise<string> {
    const resolved = path.resolve(this.workingDir, filePath);
    return fs.readFile(resolved, 'utf-8');
  }

  /**
   * 写入本地文件
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    const resolved = path.resolve(this.workingDir, filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, 'utf-8');
  }

  /**
   * 列出本地目录资源
   */
  async listResources(
    dirPath?: string,
    options?: { maxResults?: number; recursive?: boolean }
  ): Promise<WorkspaceListResult> {
    const targetPath = dirPath
      ? path.resolve(this.workingDir, dirPath)
      : this.workingDir;

    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    const files: WorkspaceFileInfo[] = [];
    const maxResults = options?.maxResults || 1000;

    for (const entry of entries) {
      if (files.length >= maxResults) break;

      try {
        const fullPath = path.join(targetPath, entry.name);
        const stat = await fs.stat(fullPath);
        files.push({
          path: fullPath,
          size: stat.size,
          isDirectory: entry.isDirectory(),
          modifiedAt: stat.mtime,
          permissions: this.modeToPermissions(stat.mode),
        });
      } catch (err) {
        // 跳过无权限访问的文件

        handleError(err, { module: 'sandbox:adapters', action: 'listFiles' });
      }
    }

    return {
      files,
      truncated: files.length >= maxResults,
      totalCount: entries.length,
    };
  }

  /**
   * 在本地执行命令
   */
  async execute(
    command: string,
    options?: Partial<SandboxExecuteOptions>
  ): Promise<SandboxExecuteResult> {
    const startTime = Date.now();
    const cwd = options?.cwd || this.workingDir;

    // G1-沙箱（2026-11-03）：**只读**本地适配器走宿主 `exec`，cwd 无效时 libuv 会把
    // `chdir` 失败报成 `ENOENT … uv_spawn 'cmd.exe'`（把排查带偏到"缺可执行文件"）。
    // 这里只做**执行前判定**（fail-closed），不改权限位、不降级到别的目录。
    // 注：Docker / SSH 适配器的 cwd 是**容器内/远端**路径，宿主不存在是正常的 ⇒ 不在此处判定。
    const cwdError = describeUnusableSpawnCwd(cwd, '沙箱工作目录');
    if (cwdError) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: cwdError,
        executionTime: Date.now() - startTime,
        error: cwdError,
      };
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: options?.timeout || 30000,
        env: options?.env as Record<string, string>,
      });

      return {
        success: true,
        exitCode: 0,
        stdout,
        stderr,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const execErr = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      return {
        success: false,
        exitCode: execErr.code || 1,
        stdout: execErr.stdout || '',
        stderr: execErr.stderr || execErr.message || '',
        executionTime: Date.now() - startTime,
        error: execErr.message || String(error),
      };
    }
  }

  /**
   * 将文件模式转换为权限字符串
   */
  private modeToPermissions(mode: number): string {
    const owner =
      (mode & 0o400 ? 'r' : '-') +
      (mode & 0o200 ? 'w' : '-') +
      (mode & 0o100 ? 'x' : '-');
    const group =
      (mode & 0o040 ? 'r' : '-') +
      (mode & 0o020 ? 'w' : '-') +
      (mode & 0o010 ? 'x' : '-');
    const other =
      (mode & 0o004 ? 'r' : '-') +
      (mode & 0o002 ? 'w' : '-') +
      (mode & 0o001 ? 'x' : '-');
    return owner + group + other;
  }
}
