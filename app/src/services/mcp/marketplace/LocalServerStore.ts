import * as fs from 'fs';
import * as path from 'path';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { InstalledMCPServer, MCPLocalStoreData } from './types';

const logger = new Logger({
  module: 'services:mcp:localServerStore',
  level: LogLevel.INFO,
});

const STORE_VERSION = 1;

export class LocalServerStore {
  private storePath: string;
  private cacheDir: string;
  private data: MCPLocalStoreData;

  constructor(mcpHomePath: string) {
    this.storePath = path.join(mcpHomePath, 'servers.json');
    this.cacheDir = path.join(mcpHomePath, 'cache');
    this.data = this.loadStore();
  }

  private ensureDirs(): void {
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private loadStore(): MCPLocalStoreData {
    if (!fs.existsSync(this.storePath)) {
      return {
        version: STORE_VERSION,
        updatedAt: new Date().toISOString(),
        servers: {},
        disabledTools: [],
      };
    }

    try {
      const content = fs.readFileSync(this.storePath, 'utf8');
      const data = JSON.parse(content) as MCPLocalStoreData;
      // 兼容旧数据无 disabledTools 字段
      if (!Array.isArray(data.disabledTools)) {
        data.disabledTools = [];
      }
      return data;
    } catch (error) {
      void handleError(error, {
        module: 'services:mcp:marketplace',
        action: 'read_store',
        context: { storePath: this.storePath },
      });
      return {
        version: STORE_VERSION,
        updatedAt: new Date().toISOString(),
        servers: {},
        disabledTools: [],
      };
    }
  }

  private saveStore(): void {
    this.ensureDirs();
    this.data.updatedAt = new Date().toISOString();

    try {
      fs.writeFileSync(
        this.storePath,
        JSON.stringify(this.data, null, 2),
        'utf8'
      );
    } catch (error) {
      void handleError(error, {
        module: 'services:mcp:marketplace',
        action: 'save_store',
      });
    }
  }

  getAllServers(): InstalledMCPServer[] {
    return Object.values(this.data.servers);
  }

  getServer(name: string): InstalledMCPServer | undefined {
    return this.data.servers[name];
  }

  addServer(server: InstalledMCPServer): void {
    this.data.servers[server.name] = server;
    this.saveStore();
  }

  removeServer(name: string): void {
    delete this.data.servers[name];
    this.saveStore();
  }

  updateServer(name: string, updates: Partial<InstalledMCPServer>): void {
    const existing = this.data.servers[name];
    if (existing) {
      this.data.servers[name] = {
        ...existing,
        ...updates,
        updatedAt: Date.now(),
      };
      this.saveStore();
    }
  }

  toggleServer(name: string, enabled: boolean): void {
    this.updateServer(name, { enabled });
  }

  /**
   * 切换工具启用/禁用状态
   */
  toggleTool(serverName: string, toolName: string, enabled: boolean): void {
    const key = `${serverName}:${toolName}`;
    if (enabled) {
      this.data.disabledTools = this.data.disabledTools.filter(
        (t) => t !== key
      );
    } else if (!this.data.disabledTools.includes(key)) {
      this.data.disabledTools.push(key);
    }
    this.saveStore();
  }

  /**
   * 判断工具是否被禁用
   */
  isToolDisabled(serverName: string, toolName: string): boolean {
    return this.data.disabledTools.includes(`${serverName}:${toolName}`);
  }

  isInstalled(name: string): boolean {
    return name in this.data.servers;
  }

  getInstalledCount(): number {
    return Object.keys(this.data.servers).length;
  }

  setSearchCache(registry: string, query: string, data: unknown): void {
    this.ensureDirs();
    const cacheFile = path.join(
      this.cacheDir,
      `${registry}-${encodeURIComponent(query)}.json`
    );

    try {
      fs.writeFileSync(
        cacheFile,
        JSON.stringify({ data, cachedAt: Date.now() }),
        'utf8'
      );
    } catch (error) {
      logger.warn(`写入搜索缓存失败: ${cacheFile}`, error as Error);
    }
  }

  getSearchCache(
    registry: string,
    query: string,
    maxAgeMs = 5 * 60 * 1000
  ): unknown | null {
    const cacheFile = path.join(
      this.cacheDir,
      `${registry}-${encodeURIComponent(query)}.json`
    );

    if (!fs.existsSync(cacheFile)) {
      return null;
    }

    try {
      const content = fs.readFileSync(cacheFile, 'utf8');
      const cached = JSON.parse(content);

      if (Date.now() - cached.cachedAt > maxAgeMs) {
        return null;
      }

      return cached.data;
    } catch {
      return null;
    }
  }

  getStorePath(): string {
    return this.storePath;
  }

  getCacheDir(): string {
    return this.cacheDir;
  }
}
