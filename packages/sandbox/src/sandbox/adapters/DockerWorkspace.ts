/**
 * Docker 工作空间适配器
 * 通过 docker exec 实现文件读写
 */

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
import {
  DockerSandbox,
  DOCKER_CONFIG_KEYS,
  type DockerVolumeMount,
} from '../docker/index';
import { isSameWorkspacePath } from '../isolationPathMap';

/**
 * Docker 工作空间适配器
 * 包装 DockerSandbox 提供文件操作接口
 */
export class DockerWorkspace extends WorkspaceBase {
  private readonly dockerSandbox: DockerSandbox;

  constructor(config: SandboxConfig) {
    super(config);
    this.dockerSandbox = new DockerSandbox();
  }

  /** 方案 A 取证：文件读写经 `docker exec` 落在容器内 ⇒ 真隔离 */
  override isolationMode(): 'container' {
    return 'container';
  }

  /**
   * 方案 A 路由（2026-10-23）：容器里**所有 `rw` 挂载**都可作为文件的落点。
   *
   * 为什么不止工作区根：`write_project_file` 落在**项目 sandbox**（data 目录），
   * 只有项目根也被挂进容器时，它的写才是真隔离（§12.15）。
   * 只读（`ro`）挂载不参与：写不进去，不能声称文件 IO 隔离。
   */
  override fileIoMounts(): Array<{ hostRoot: string; isolatedRoot: string }> {
    const volumes = (this.config.customConfig?.[DOCKER_CONFIG_KEYS.VOLUMES] ??
      []) as DockerVolumeMount[];
    return volumes
      .filter((vol) => vol.mode === 'rw')
      .map((vol) => ({
        hostRoot: vol.hostPath,
        isolatedRoot: vol.containerPath,
      }));
  }

  /** **工作区根**对应的挂载（`fileIoMount` 的单挂载语义；无 ⇒ `null`） */
  override fileIoMount(): { hostRoot: string; isolatedRoot: string } | null {
    const hostRoot = this.config.workingDirectory;
    if (!hostRoot) return null;
    return (
      this.fileIoMounts().find((mount) =>
        isSameWorkspacePath(mount.hostRoot, hostRoot)
      ) ?? null
    );
  }

  /**
   * 通过 docker exec 读取文件内容
   */
  async readFile(path: string): Promise<string> {
    const result = await this.dockerSandbox.execute({
      args: ['cat', path],
    });

    if (!result.success) {
      throw new Error(`读取文件失败: ${path}\n${result.stderr}`);
    }
    return result.stdout;
  }

  /**
   * 通过 docker exec 写入文件内容
   */
  async writeFile(path: string, content: string): Promise<void> {
    const result = await this.dockerSandbox.execute({
      args: ['sh', '-c', `cat > '${path}' << 'EOF'\n${content}\nEOF`],
    });

    if (!result.success) {
      throw new Error(`写入文件失败: ${path}\n${result.stderr}`);
    }
  }

  /**
   * 列出容器内目录资源
   */
  async listResources(
    path?: string,
    options?: { maxResults?: number; recursive?: boolean }
  ): Promise<WorkspaceListResult> {
    const targetPath = path || this.config.workingDirectory || '/';
    const recursive = options?.recursive ? '-R' : '';
    const result = await this.dockerSandbox.execute({
      args: ['ls', '-la', recursive, targetPath],
    });

    if (!result.success) {
      return { files: [], truncated: false, totalCount: 0 };
    }

    const files = this.parseLsOutput(result.stdout, targetPath);
    const maxResults = options?.maxResults || 1000;
    const truncated = files.length > maxResults;

    return {
      files: truncated ? files.slice(0, maxResults) : files,
      truncated,
      totalCount: files.length,
    };
  }

  /**
   * 在容器中执行命令
   */
  async execute(
    command: string,
    options?: Partial<SandboxExecuteOptions>
  ): Promise<SandboxExecuteResult> {
    return this.dockerSandbox.execute({
      args: ['sh', '-c', command],
      ...options,
    });
  }

  /**
   * 解析 ls -la 输出
   */
  private parseLsOutput(output: string, basePath: string): WorkspaceFileInfo[] {
    const lines = output.trim().split('\n');
    const files: WorkspaceFileInfo[] = [];

    for (const line of lines) {
      if (!line || line.startsWith('total ')) {
        continue;
      }
      const parts = line.split(/\s+/);
      if (parts.length < 9) continue;

      const perms = parts[0];
      const name = parts.slice(8).join(' ');
      if (name === '.' || name === '..') continue;

      files.push({
        path: `${basePath}/${name}`,
        size: parseInt(parts[4], 10) || 0,
        isDirectory: perms.startsWith('d'),
        modifiedAt: new Date(`${parts[5]} ${parts[6]} ${parts[7]}`),
        permissions: perms,
        owner: parts[2],
      });
    }

    return files;
  }
}
