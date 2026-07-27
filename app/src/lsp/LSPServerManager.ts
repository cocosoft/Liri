import { pathToFileURL } from 'url';

import type { ScopedLspServerConfig, Diagnostic } from './types.js';
import {
  createLSPServerInstance,
  type LSPServerInstance,
} from './LSPServerInstance.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'lsp\LSPServerManager',
  level: LogLevel.INFO,
});

export type LSPServerManager = {
  initialize(configs: ScopedLspServerConfig[]): Promise<void>;
  shutdown(): Promise<void>;
  getServerForFile(filePath: string): LSPServerInstance | undefined;
  ensureServerStarted(name: string): Promise<void>;
  getAllServers(): Map<string, LSPServerInstance>;
  getServer(name: string): LSPServerInstance | undefined;
  isReady(): boolean;
  openFile(filePath: string, text: string): Promise<void>;
  changeFile(filePath: string, text: string): Promise<void>;
  saveFile(filePath: string): Promise<void>;
  closeFile(filePath: string): Promise<void>;
  isFileOpen(filePath: string): boolean;
  sendRequest<T>(filePath: string, method: string, params: unknown): Promise<T>;
  onNotification(method: string, handler: (params: unknown) => void): void;
};

export function createLSPServerManager(): LSPServerManager {
  const serverInstances = new Map<string, LSPServerInstance>();
  const openedFiles = new Map<string, string>();
  const notificationHandlers = new Map<
    string,
    Set<(params: unknown) => void>
  >();
  let initialized = false;

  function getExtension(filePath: string): string {
    const parts = filePath.split('.');
    return parts.length > 1 ? `.${parts[parts.length - 1].toLowerCase()}` : '';
  }

  function findServerForExtension(ext: string): LSPServerInstance | undefined {
    for (const server of serverInstances.values()) {
      const serverExts =
        server.config.command === 'typescript-language-server'
          ? ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
          : server.config.command === 'rust-analyzer'
            ? ['.rs']
            : server.config.command === 'gopls'
              ? ['.go']
              : server.config.command === 'pylsp'
                ? ['.py']
                : server.config.command === 'clangd'
                  ? ['.c', '.cpp', '.h', '.hpp', '.cxx', '.cc']
                  : server.config.command === 'jdtls'
                    ? ['.java']
                    : [];

      if (serverExts.includes(ext)) return server;
    }
    return undefined;
  }

  function detectServerConfig(
    filePath: string
  ): ScopedLspServerConfig | undefined {
    const ext = getExtension(filePath);

    const extToConfig: Record<string, ScopedLspServerConfig> = {
      '.ts': { command: 'typescript-language-server', args: ['--stdio'] },
      '.tsx': { command: 'typescript-language-server', args: ['--stdio'] },
      '.js': { command: 'typescript-language-server', args: ['--stdio'] },
      '.jsx': { command: 'typescript-language-server', args: ['--stdio'] },
      '.mjs': { command: 'typescript-language-server', args: ['--stdio'] },
      '.cjs': { command: 'typescript-language-server', args: ['--stdio'] },
      '.rs': { command: 'rust-analyzer', args: [] },
      '.go': { command: 'gopls', args: [] },
      '.py': { command: 'pylsp', args: [] },
      '.c': { command: 'clangd', args: ['--background-index'] },
      '.cpp': { command: 'clangd', args: ['--background-index'] },
      '.h': { command: 'clangd', args: ['--background-index'] },
      '.hpp': { command: 'clangd', args: ['--background-index'] },
      '.java': { command: 'jdtls', args: [] },
    };

    return extToConfig[ext];
  }

  function getServerName(config: ScopedLspServerConfig): string {
    return `${config.command}-${(config.args || []).join('-')}`;
  }

  return {
    async initialize(configs: ScopedLspServerConfig[]): Promise<void> {
      for (const config of configs) {
        const name = getServerName(config);
        if (!serverInstances.has(name)) {
          const instance = createLSPServerInstance(name, config);
          serverInstances.set(name, instance);
        }
      }
      initialized = true;
    },

    async shutdown(): Promise<void> {
      const promises: Promise<void>[] = [];
      for (const [name, instance] of serverInstances) {
        // @ignore-catch — 关闭阶段best-effort停止LSP实例，单个失败不阻塞其他
        promises.push(instance.stop().catch(() => {}));
      }
      await Promise.all(promises);
      serverInstances.clear();
      openedFiles.clear();
      initialized = false;
    },

    getServerForFile(filePath: string): LSPServerInstance | undefined {
      const ext = getExtension(filePath);
      let server = findServerForExtension(ext);

      if (!server) {
        const config = detectServerConfig(filePath);
        if (config) {
          const name = getServerName(config);
          if (!serverInstances.has(name)) {
            server = createLSPServerInstance(name, config);
            serverInstances.set(name, server);
          } else {
            server = serverInstances.get(name)!;
          }
        }
      }

      return server;
    },

    async ensureServerStarted(name: string): Promise<void> {
      const server = serverInstances.get(name);
      if (!server) {
        throw new AppError(
          `LSP server '${name}' not found`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      if (!server.isHealthy() && server.state !== 'starting') {
        await server.start();
      }
    },

    getAllServers(): Map<string, LSPServerInstance> {
      return new Map(serverInstances);
    },

    getServer(name: string): LSPServerInstance | undefined {
      return serverInstances.get(name);
    },

    isReady(): boolean {
      return initialized && serverInstances.size > 0;
    },

    async openFile(filePath: string, text: string): Promise<void> {
      const server = this.getServerForFile(filePath);
      if (!server) return;

      await this.ensureServerStarted(server.name);

      const uri = pathToFileURL(filePath).href;
      await server.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId: filePath.endsWith('.ts') ? 'typescript' : 'plaintext',
          version: 1,
          text,
        },
      });

      openedFiles.set(filePath, server.name);
    },

    async changeFile(filePath: string, text: string): Promise<void> {
      const server = this.getServerForFile(filePath);
      if (!server) return;

      await server.sendNotification('textDocument/didChange', {
        textDocument: {
          uri: pathToFileURL(filePath).href,
          version: Date.now(),
        },
        contentChanges: [{ text }],
      });
    },

    async saveFile(filePath: string): Promise<void> {
      const server = this.getServerForFile(filePath);
      if (!server) return;

      await server.sendNotification('textDocument/didSave', {
        textDocument: { uri: pathToFileURL(filePath).href },
      });
    },

    async closeFile(filePath: string): Promise<void> {
      const serverName = openedFiles.get(filePath);
      if (!serverName) return;

      const server = serverInstances.get(serverName);
      if (server) {
        await server.sendNotification('textDocument/didClose', {
          textDocument: { uri: pathToFileURL(filePath).href },
        });
      }

      openedFiles.delete(filePath);
    },

    isFileOpen(filePath: string): boolean {
      return openedFiles.has(filePath);
    },

    async sendRequest<T>(
      filePath: string,
      method: string,
      params: unknown
    ): Promise<T> {
      const server = this.getServerForFile(filePath);
      if (!server) {
        throw new AppError(
          `No LSP server available for file: ${filePath}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      await this.ensureServerStarted(server.name);
      return server.sendRequest<T>(method, params);
    },

    onNotification(method: string, handler: (params: unknown) => void): void {
      const existing = notificationHandlers.get(method);
      if (existing) {
        existing.add(handler);
      } else {
        notificationHandlers.set(method, new Set([handler]));
      }

      for (const server of serverInstances.values()) {
        server.onNotification(method, handler);
      }
    },
  };
}
