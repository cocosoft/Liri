/**
 * ChannelPluginPresence 渠道插件存在检测
 * 对标 OpenClaw 的渠道插件存在检测系统，检查渠道插件是否可用
 * 使用系统自带的 fs/path 模块，不使用 require.resolve
 */
import fs from 'fs';
import path from 'path';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'plugins:channel:channelPluginPresence',
  level: LogLevel.INFO,
});

/**
 * 存在检测结果
 */
export interface PresenceResult {
  available: boolean;
  dependencies: DependencyStatus[];
  issues: string[];
}

/**
 * 依赖状态
 */
export interface DependencyStatus {
  name: string;
  resolved: boolean;
  version?: string;
  error?: string;
}

/**
 * 渠道插件存在检测器
 */
export class ChannelPluginPresence {
  private pluginDirs: string[];
  private nodeModulesPaths: string[];

  constructor(pluginDirs?: string[], nodeModulesPaths?: string[]) {
    this.pluginDirs = pluginDirs || [];
    this.nodeModulesPaths = nodeModulesPaths || this.resolveNodeModulesPaths();
  }

  /**
   * 设置插件目录
   */
  setPluginDirs(dirs: string[]): void {
    this.pluginDirs = dirs;
  }

  /**
   * 解析 node_modules 路径
   */
  private resolveNodeModulesPaths(): string[] {
    const paths: string[] = [];
    let current = process.cwd();

    for (let i = 0; i < 10; i++) {
      const nmPath = path.join(current, 'node_modules');

      if (fs.existsSync(nmPath)) {
        paths.push(nmPath);
      }

      const parent = path.dirname(current);

      if (parent === current) {
        break;
      }

      current = parent;
    }

    return paths;
  }

  /**
   * 检测渠道插件是否存在
   */
  checkPresence(channelName: string, dependencies?: string[]): PresenceResult {
    const depResults: DependencyStatus[] = [];
    const issues: string[] = [];

    if (dependencies) {
      for (const dep of dependencies) {
        depResults.push(this.checkDependency(dep));
      }

      const missing = depResults.filter((d) => !d.resolved);

      if (missing.length > 0) {
        issues.push(`缺少依赖: ${missing.map((d) => d.name).join(', ')}`);
      }
    }

    const pluginAvailable = this.checkPluginAvailable(channelName);

    if (!pluginAvailable) {
      issues.push(`渠道插件 "${channelName}" 文件不存在`);
    }

    return {
      available: pluginAvailable && depResults.every((d) => d.resolved),
      dependencies: depResults,
      issues,
    };
  }

  /**
   * 检测依赖项（使用 fs 代替 require.resolve）
   */
  private checkDependency(name: string): DependencyStatus {
    for (const nmPath of this.nodeModulesPaths) {
      const depPath = path.join(nmPath, name);

      if (fs.existsSync(depPath)) {
        const pkgJsonPath = path.join(depPath, 'package.json');
        let version: string | undefined;

        if (fs.existsSync(pkgJsonPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
            version = pkg.version;
          } catch (err) {
            // 忽略版本解析失败
          }
        }

        return {
          name,
          resolved: true,
          version,
        };
      }
    }

    return {
      name,
      resolved: false,
      error: `模块 "${name}" 未安装`,
    };
  }

  /**
   * 检测插件文件是否存在
   */
  private checkPluginAvailable(channelName: string): boolean {
    for (const dir of this.pluginDirs) {
      const pluginPath = path.join(dir, channelName);

      if (fs.existsSync(pluginPath)) {
        return true;
      }

      const indexFile = path.join(dir, channelName, 'index.js');

      if (fs.existsSync(indexFile)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 批量检测
   */
  checkBatch(
    channels: Array<{ name: string; dependencies?: string[] }>
  ): Map<string, PresenceResult> {
    const results = new Map<string, PresenceResult>();

    for (const channel of channels) {
      results.set(
        channel.name,
        this.checkPresence(channel.name, channel.dependencies)
      );
    }

    return results;
  }

  /**
   * 通道消息广播 — 可选 TTS 输出
   * 当配置开启自动 TTS 时，将文本消息转为语音
   */
  async broadcastWithTTS(
    channelName: string,
    message: string,
    options?: { tts?: boolean }
  ): Promise<void> {
    if (options?.tts) {
      try {
        const { VoiceChannelIntegration } =
          await import('../../voice/VoiceChannelIntegration');
        const channelIntegration = new VoiceChannelIntegration({});
        await channelIntegration.sendVoiceMessage({ text: message });
      } catch (error) {
        logger.warn('TTS 语音消息发送失败', {
          channel: channelName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * 获取可用的渠道插件列表
   */
  getAvailableChannels(): string[] {
    const available: string[] = [];

    for (const dir of this.pluginDirs) {
      if (!fs.existsSync(dir)) {
        continue;
      }

      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() || entry.name.endsWith('.js')) {
          const name = entry.name.replace(/\.js$/, '');

          if (!available.includes(name)) {
            available.push(name);
          }
        }
      }
    }

    return available;
  }
}

export const channelPluginPresence = new ChannelPluginPresence();
