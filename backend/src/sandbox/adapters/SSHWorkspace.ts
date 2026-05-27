/**
 * SSH 远程工作空间适配器
 * 通过 SSH 命令执行远程文件操作
 */

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
} from '../types/SandboxTypes';
import type { SSHSandboxConfig } from '../SSHSandbox';

const execAsync = promisify(exec);

/**
 * SSH 远程工作空间适配器
 * 通过 SSH 连接远程执行文件操作和命令
 */
export class SSHWorkspace extends WorkspaceBase {
  private readonly sshConfig: SSHSandboxConfig;

  constructor(config: SandboxConfig, sshConfig: SSHSandboxConfig) {
    super(config);
    this.sshConfig = sshConfig;
  }

  /**
   * 构建 SSH 连接字符串
   */
  private get sshBase(): string {
    const { host, port, username, privateKeyPath } = this.sshConfig;
    let cmd = `ssh -p ${port} -o StrictHostKeyChecking=no -o ConnectTimeout=10`;
    if (privateKeyPath) {
      cmd += ` -i ${privateKeyPath}`;
    }
    cmd += ` ${username}@${host}`;
    return cmd;
  }

  /**
   * 通过 SSH 读取远程文件
   */
  async readFile(filePath: string): Promise<string> {
    const { stdout, stderr } = await execAsync(
      `${this.sshBase} "cat '${filePath}'"`
    );
    if (stderr) {
      throw new Error(`SSH 读取文件失败: ${filePath}\n${stderr}`);
    }
    return stdout;
  }

  /**
   * 通过 SSH 写入远程文件
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    const { stderr } = await execAsync(
      `${this.sshBase} "cat > '${filePath}' << 'EOF'\n${content}\nEOF"`
    );
    if (stderr) {
      throw new Error(`SSH 写入文件失败: ${filePath}\n${stderr}`);
    }
  }

  /**
   * 列出远程目录
   */
  async listResources(
    dirPath?: string,
    options?: { maxResults?: number; recursive?: boolean }
  ): Promise<WorkspaceListResult> {
    const targetPath = dirPath || this.config.workingDirectory || '~';
    const recursive = options?.recursive ? '-R' : '';
    const { stdout } = await execAsync(
      `${this.sshBase} "ls -la ${recursive} '${targetPath}'"`
    );
    const lines = stdout.trim().split('\n');
    const files: WorkspaceFileInfo[] = [];
    const maxResults = options?.maxResults || 1000;

    for (const line of lines) {
      if (!line || line.startsWith('total ')) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 9) continue;

      const perms = parts[0];
      const name = parts.slice(8).join(' ');
      if (name === '.' || name === '..') continue;

      files.push({
        path: `${targetPath}/${name}`,
        size: parseInt(parts[4], 10) || 0,
        isDirectory: perms.startsWith('d'),
        modifiedAt: new Date(),
        permissions: perms,
        owner: parts[2],
      });

      if (files.length >= maxResults) break;
    }

    return {
      files,
      truncated: files.length >= maxResults,
      totalCount: lines.length,
    };
  }

  /**
   * 在远程执行命令
   */
  async execute(
    command: string,
    options?: Partial<SandboxExecuteOptions>
  ): Promise<SandboxExecuteResult> {
    const startTime = Date.now();

    try {
      const { stdout, stderr } = await execAsync(
        `${this.sshBase} "${command}"`,
        { timeout: options?.timeout || 30000 }
      );

      return {
        success: true,
        exitCode: 0,
        stdout,
        stderr,
        executionTime: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        exitCode: error.code || 1,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        executionTime: Date.now() - startTime,
        error: error.message,
      };
    }
  }
}
