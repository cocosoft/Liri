/**
 * Docker 镜像管理器
 * 管理 Docker 镜像的拉取、列表、删除、构建等操作
 */

import { execSync } from 'child_process';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = new Logger({
  module: 'sandbox:dockerManager',
  level: LogLevel.INFO,
});

export interface DockerImageInfo {
  repository: string;
  tag: string;
  imageId: string;
  created: string;
  size: string;
}

export class DockerImageManager {
  async imageExists(name: string): Promise<boolean> {
    try {
      execSync(`docker image inspect ${name}`, {
        stdio: 'pipe',
        timeout: 10000,
      });
      return true;
    } catch {
      void handleError(new Error(`Docker image not found: ${name}`), { module: 'sandbox:image', action: 'imageExists' });
      return false;
    }
  }

  async pullImage(name: string, platform?: string): Promise<boolean> {
    try {
      const args = ['docker', 'pull', name];
      if (platform) {
        args.push('--platform', platform);
      }
      execSync(args.join(' '), { stdio: 'pipe', timeout: 120000 });
      logger.info(`Docker 镜像拉取完成: ${name}`);
      return true;
    } catch (error) {
      void handleError(error, { module: 'sandbox:image', action: 'pullImage' });
      logger.error(`Docker 镜像拉取失败: ${name}`, error as Error);
      return false;
    }
  }

  listImages(): DockerImageInfo[] {
    try {
      const output = execSync(
        'docker images --format "{{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.CreatedAt}}\t{{.Size}}"',
        { encoding: 'utf-8', timeout: 10000 }
      );

      return output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [repository, tag, imageId, created, size] = line.split('\t');
          return { repository, tag, imageId, created, size };
        });
    } catch (error) {
      void handleError(error, { module: 'sandbox:image', action: 'listImages' });
      logger.error('列出 Docker 镜像失败', error as Error);
      return [];
    }
  }

  async removeImage(name: string, force: boolean = false): Promise<boolean> {
    try {
      const args = ['docker', 'rmi'];
      if (force) {
        args.push('-f');
      }
      args.push(name);
      execSync(args.join(' '), { stdio: 'pipe', timeout: 30000 });
      logger.info(`Docker 镜像已删除: ${name}`);
      return true;
    } catch (error) {
      void handleError(error, { module: 'sandbox:image', action: 'removeImage' });
      logger.error(`Docker 镜像删除失败: ${name}`, error as Error);
      return false;
    }
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
    try {
      const args = ['docker', 'build'];

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

      execSync(args.join(' '), { stdio: 'pipe', timeout: 300000 });
      logger.info(`Docker 镜像构建完成: ${options.tag || context}`);
      return true;
    } catch (error) {
      void handleError(error, { module: 'sandbox:image', action: 'buildImage' });
      logger.error(`Docker 镜像构建失败: ${context}`, error as Error);
      return false;
    }
  }

  async pruneImages(all: boolean = false): Promise<number> {
    try {
      const args = ['docker', 'image', 'prune', '-f'];
      if (all) {
        args.push('-a');
      }
      const output = execSync(args.join(' '), {
        encoding: 'utf-8',
        timeout: 60000,
      });
      const match = output.match(/Total reclaimed space:\s+(.+)$/m);
      const reclaimed = match ? match[1] : 'unknown';
      logger.info(`Docker 镜像清理完成，回收空间: ${reclaimed}`);
      return 0;
    } catch (error) {
      void handleError(error, { module: 'sandbox:image', action: 'pruneImages' });
      logger.error('Docker 镜像清理失败', error as Error);
      return -1;
    }
  }

  getImageSize(name: string): string | null {
    try {
      const output = execSync(
        `docker image inspect ${name} --format '{{.Size}}'`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      return output.trim();
    } catch {
      void handleError(new Error(`Failed to get Docker image size: ${name}`), { module: 'sandbox:image', action: 'getImageSize' });
      return null;
    }
  }
}
