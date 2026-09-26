/**
 * Docker 镜像管理器
 * 管理 Docker 镜像的拉取、列表、删除、构建等操作
 *
 * ⚠️ **B3-a（2026-09-26，《Liri 优化方案》）**：本模块原先**全部**用 `execSync`，
 * 其中最要命的是 `pullImage`（`:43`，超时 120s）—— 它在 **daemon 进程内同步阻塞事件循环**
 * ⇒ 拉镜像期间**全部 HTTP / SSE 停摆**（与论文无关，**自身即缺陷**）。
 *
 * 现改为**异步 CLI 执行器**（`execFile` + Promise），并把执行器做成**可注入**：
 * ① 生产走真实 `docker`；② 测试可注入假执行器 —— 从而能**离线**断言"调用是异步的、
 * 事件循环不被阻塞"以及各方法的成败分支（无需本机安装 Docker）。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import { defaultDockerCliRunner, type DockerCliRunner } from './dockerCli';

const logger = getLogger('sandbox:dockerManager');

export interface DockerImageInfo {
  repository: string;
  tag: string;
  imageId: string;
  created: string;
  size: string;
}

export class DockerImageManager {
  constructor(private readonly run: DockerCliRunner = defaultDockerCliRunner) {}

  async imageExists(name: string): Promise<boolean> {
    const res = await this.run(['image', 'inspect', name], {
      timeoutMs: 10_000,
    });
    if (res.ok) return true;
    // 顺带修正（同批）：**"镜像不存在"是首次运行的正常路径**，此前按 ERROR 记入 ErrorTracker
    // ⇒ 污染错误统计。此处降级为 debug；真正的异常（docker 未安装/权限）仍可在 debug 里看到原因。
    logger.debug('镜像不存在或 docker 不可用', {
      name,
      error: res.error?.message,
    });
    return false;
  }

  async pullImage(name: string, platform?: string): Promise<boolean> {
    const args = ['pull', name];
    if (platform) {
      args.push('--platform', platform);
    }
    const res = await this.run(args, { timeoutMs: 120_000 });
    if (!res.ok) {
      void handleError(res.error ?? new Error(`docker pull 失败: ${name}`), {
        module: 'sandbox:image',
        action: 'pullImage',
      });
      logger.error(`Docker 镜像拉取失败: ${name}`, res.error);
      return false;
    }
    logger.info(`Docker 镜像拉取完成: ${name}`);
    return true;
  }

  async listImages(): Promise<DockerImageInfo[]> {
    const res = await this.run(
      [
        'images',
        '--format',
        '{{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.CreatedAt}}\t{{.Size}}',
      ],
      { timeoutMs: 10_000 }
    );
    if (!res.ok) {
      void handleError(res.error ?? new Error('docker images 失败'), {
        module: 'sandbox:image',
        action: 'listImages',
      });
      logger.error('列出 Docker 镜像失败', res.error);
      return [];
    }
    return res.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [repository, tag, imageId, created, size] = line.split('\t');
        return { repository, tag, imageId, created, size };
      });
  }

  async removeImage(name: string, force: boolean = false): Promise<boolean> {
    const args = ['rmi'];
    if (force) {
      args.push('-f');
    }
    args.push(name);
    const res = await this.run(args, { timeoutMs: 30_000 });
    if (!res.ok) {
      void handleError(res.error ?? new Error(`docker rmi 失败: ${name}`), {
        module: 'sandbox:image',
        action: 'removeImage',
      });
      logger.error(`Docker 镜像删除失败: ${name}`, res.error);
      return false;
    }
    logger.info(`Docker 镜像已删除: ${name}`);
    return true;
  }

  async buildImage(
    context: string,
    options: {
      dockerfile?: string;
      tag?: string;
      buildArgs?: Record<string, string>;
      noCache?: boolean;
    } = {}
  ): Promise<boolean> {
    const args = ['build'];

    if (options.dockerfile) {
      args.push('-f', options.dockerfile);
    }
    if (options.tag) {
      args.push('-t', options.tag);
    }
    if (options.noCache) {
      args.push('--no-cache');
    }
    if (options.buildArgs) {
      for (const [key, value] of Object.entries(options.buildArgs)) {
        args.push('--build-arg', `${key}=${value}`);
      }
    }

    args.push(context);

    const res = await this.run(args, { timeoutMs: 300_000 });
    if (!res.ok) {
      void handleError(
        res.error ?? new Error(`docker build 失败: ${context}`),
        {
          module: 'sandbox:image',
          action: 'buildImage',
        }
      );
      logger.error(`Docker 镜像构建失败: ${context}`, res.error);
      return false;
    }
    logger.info(`Docker 镜像构建完成: ${options.tag || context}`);
    return true;
  }

  async pruneImages(all: boolean = false): Promise<number> {
    const args = ['image', 'prune', '-f'];
    if (all) {
      args.push('-a');
    }
    const res = await this.run(args, { timeoutMs: 60_000 });
    if (!res.ok) {
      void handleError(res.error ?? new Error('docker image prune 失败'), {
        module: 'sandbox:image',
        action: 'pruneImages',
      });
      logger.error('Docker 镜像清理失败', res.error);
      return -1;
    }
    const match = res.stdout.match(/Total reclaimed space:\s+(.+)$/m);
    const reclaimed = match ? match[1] : 'unknown';
    logger.info(`Docker 镜像清理完成，回收空间: ${reclaimed}`);
    return 0;
  }

  async getImageSize(name: string): Promise<string | null> {
    const res = await this.run(
      ['image', 'inspect', name, '--format', '{{.Size}}'],
      { timeoutMs: 10_000 }
    );
    if (!res.ok) {
      logger.debug('获取镜像体积失败', { name, error: res.error?.message });
      return null;
    }
    return res.stdout.trim();
  }
}
