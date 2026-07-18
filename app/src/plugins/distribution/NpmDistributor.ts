/**
 * NPM 插件分发器
 * 从 npm registry 安装/更新/卸载插件
 * 对齐 OpenClaw 插件分发机制
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { resolveProjectRoot } from '@modules/core';
import { execSync } from 'child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'plugins:distribution:npmDistributor',
  level: LogLevel.INFO,
});

export interface NpmInstallResult {
  success: boolean;
  name: string;
  version?: string;
  error?: string;
  path?: string;
}

export interface NpmPluginInfo {
  name: string;
  version: string;
  capability?: string;
  description?: string;
  source: 'npm' | 'local' | 'bundled';
  installedAt: number;
}

export interface NpmUpdateResult {
  name: string;
  success: boolean;
  version?: string;
  error?: string;
}

export class NpmDistributor {
  private pluginsDir: string;
  private registry: string;

  constructor(pluginsDir?: string, registry?: string) {
    this.pluginsDir = pluginsDir || join(resolveProjectRoot(), 'plugins');
    this.registry = registry || 'https://registry.npmjs.org/';
    this.ensurePluginsDir();
  }

  async install(name: string, version?: string): Promise<NpmInstallResult> {
    try {
      const spec = version ? `${name}@${version}` : name;
      const targetDir = join(this.pluginsDir, name.replace('/', '-'));

      if (existsSync(targetDir)) {
        return { success: false, name, error: `插件 ${name} 已安装` };
      }

      logger.info(`安装插件: ${spec}`);
      execSync(
        `npm install ${spec} --prefix "${this.pluginsDir}" --no-save --registry ${this.registry}`,
        {
          stdio: 'pipe',
          timeout: 120000,
        }
      );

      const nodeDir = join(this.pluginsDir, 'node_modules', name);
      const pkgPath = join(nodeDir, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        writeFileSync(
          join(targetDir, '.plugin-install.json'),
          JSON.stringify(
            { name: pkg.name, version: pkg.version, installedAt: Date.now() },
            null,
            2
          )
        );
        return {
          success: true,
          name: pkg.name,
          version: pkg.version,
          path: nodeDir,
        };
      }
      return { success: false, name, error: 'package.json 未找到' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`插件安装失败: ${name}`, error as Error);
      return { success: false, name, error: msg };
    }
  }

  async remove(name: string): Promise<boolean> {
    try {
      const nodeDir = join(this.pluginsDir, 'node_modules', name);
      if (!existsSync(nodeDir)) {
        logger.warning(`插件未安装: ${name}`);
        return false;
      }
      execSync(`npm uninstall ${name} --prefix "${this.pluginsDir}"`, {
        stdio: 'pipe',
      });
      // 清理残留目录
      const pluginDir = join(this.pluginsDir, name.replace('/', '-'));
      if (existsSync(pluginDir)) {
        try {
          unlinkSync(join(pluginDir, '.plugin-install.json'));
        } catch (err) {
          void handleError(err, {
            module: 'plugins:distribution',
            action: 'catch_error',
          });
        }
      }
      logger.info(`插件已移除: ${name}`);
      return true;
    } catch (error) {
      logger.error(`插件移除失败: ${name}`, error as Error);
      return false;
    }
  }

  async update(name: string): Promise<NpmUpdateResult[]> {
    const results: NpmUpdateResult[] = [];
    try {
      const packages = name === 'all' ? [] : [name];
      if (name === 'all') {
        const installed = await this.listInstalled();
        packages.push(...installed.map((p) => p.name));
      }
      for (const pkg of packages) {
        try {
          execSync(
            `npm update ${pkg} --prefix "${this.pluginsDir}" --registry ${this.registry}`,
            {
              stdio: 'pipe',
              timeout: 60000,
            }
          );
          const pkgPath = join(
            this.pluginsDir,
            'node_modules',
            pkg,
            'package.json'
          );
          const ver = existsSync(pkgPath)
            ? JSON.parse(readFileSync(pkgPath, 'utf-8')).version
            : '?';
          results.push({ name: pkg, success: true, version: ver });
        } catch (e) {
          results.push({ name: pkg, success: false, error: String(e) });
        }
      }
    } catch (error) {
      logger.error('插件更新失败', error as Error);
    }
    return results;
  }

  async listInstalled(): Promise<NpmPluginInfo[]> {
    const info: NpmPluginInfo[] = [];
    this.ensurePluginsDir();

    try {
      const nodeDir = join(this.pluginsDir, 'node_modules');
      if (!existsSync(nodeDir)) return info;

      const { readdirSync, statSync } = require('fs');
      const entries = readdirSync(nodeDir, { withFileTypes: true });

      for (const entry of entries) {
        if (
          !entry.isDirectory() ||
          entry.name.startsWith('.') ||
          entry.name.startsWith('@')
        )
          continue;
        const pkgPath = join(nodeDir, entry.name, 'package.json');
        if (!existsSync(pkgPath)) continue;

        try {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
          const installPath = join(
            this.pluginsDir,
            entry.name.replace('/', '-'),
            '.plugin-install.json'
          );
          const installMeta = existsSync(installPath)
            ? JSON.parse(readFileSync(installPath, 'utf-8'))
            : { installedAt: 0 };

          info.push({
            name: pkg.name || entry.name,
            version: pkg.version || '?',
            capability: pkg['Liri']?.capability || 'tool',
            description: pkg.description,
            source: 'npm',
            installedAt: installMeta.installedAt || 0,
          });
        } catch (err) {
          /* skip invalid */
        }
      }
    } catch (err) {
      // 目录读取失败
    }

    info.sort((a, b) => b.installedAt - a.installedAt);
    return info;
  }

  private ensurePluginsDir(): void {
    if (!existsSync(this.pluginsDir)) {
      mkdirSync(this.pluginsDir, { recursive: true });
    }
  }
}

export { NpmDistributor as NpmPluginDistributor };
