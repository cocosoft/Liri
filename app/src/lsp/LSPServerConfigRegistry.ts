/**
 * 多语言 LSP Server 配置注册表
 * 提供默认语言服务器配置、文件扩展名到语言 ID 的映射、以及可用性检测
 */

import type { ScopedLspServerConfig } from './types.js';

export interface LanguageServerRegistration {
  language: string;
  languageId: string;
  extensions: string[];
  config: ScopedLspServerConfig;
  detectionCommand?: string;
  site?: string;
}

const DEFAULT_SERVERS: LanguageServerRegistration[] = [
  {
    language: 'TypeScript/JavaScript',
    languageId: 'typescript',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    config: { command: 'typescript-language-server', args: ['--stdio'] },
    detectionCommand: 'typescript-language-server --version',
    site: 'https://www.npmjs.com/package/typescript-language-server',
  },
  {
    language: 'Python',
    languageId: 'python',
    extensions: ['.py', '.pyw'],
    config: { command: 'pylsp', args: [] },
    detectionCommand: 'pylsp --version',
    site: 'https://github.com/python-lsp/python-lsp-server',
  },
  {
    language: 'Rust',
    languageId: 'rust',
    extensions: ['.rs'],
    config: { command: 'rust-analyzer', args: [] },
    detectionCommand: 'rust-analyzer --version',
    site: 'https://rust-analyzer.github.io/',
  },
  {
    language: 'Go',
    languageId: 'go',
    extensions: ['.go'],
    config: { command: 'gopls', args: [] },
    detectionCommand: 'gopls version',
    site: 'https://github.com/golang/tools/tree/master/gopls',
  },
  {
    language: 'C/C++',
    languageId: 'cpp',
    extensions: ['.c', '.cpp', '.h', '.hpp', '.cxx', '.cc', '.cxx'],
    config: { command: 'clangd', args: ['--background-index'] },
    detectionCommand: 'clangd --version',
    site: 'https://clangd.llvm.org/',
  },
  {
    language: 'Java',
    languageId: 'java',
    extensions: ['.java'],
    config: { command: 'jdtls', args: [] },
    site: 'https://github.com/eclipse-jdtls/eclipse.jdt.ls',
  },
  {
    language: 'JSON',
    languageId: 'json',
    extensions: ['.json', '.jsonc'],
    config: { command: 'vscode-json-languageserver', args: ['--stdio'] },
    site: 'https://www.npmjs.com/package/vscode-json-languageserver',
  },
  {
    language: 'YAML',
    languageId: 'yaml',
    extensions: ['.yaml', '.yml'],
    config: { command: 'yaml-language-server', args: ['--stdio'] },
    site: 'https://www.npmjs.com/package/yaml-language-server',
  },
  {
    language: 'Docker',
    languageId: 'dockerfile',
    extensions: ['Dockerfile', '.dockerfile'],
    config: { command: 'docker-langserver', args: ['--stdio'] },
    site: 'https://www.npmjs.com/package/docker-langserver',
  },
];

export class LSPServerConfigRegistry {
  private registrations: Map<string, LanguageServerRegistration> = new Map();
  private extensionIndex: Map<string, string> = new Map();

  constructor(defaults: LanguageServerRegistration[] = DEFAULT_SERVERS) {
    for (const reg of defaults) {
      this.register(reg);
    }
  }

  register(registration: LanguageServerRegistration): void {
    const key = registration.language;
    this.registrations.set(key, registration);

    for (const ext of registration.extensions) {
      this.extensionIndex.set(ext.toLowerCase(), key);
    }
  }

  unregister(language: string): boolean {
    const reg = this.registrations.get(language);
    if (!reg) return false;

    for (const ext of reg.extensions) {
      this.extensionIndex.delete(ext.toLowerCase());
    }

    this.registrations.delete(language);
    return true;
  }

  getConfigForFile(filePath: string): ScopedLspServerConfig | undefined {
    const reg = this.getRegistrationForFile(filePath);
    return reg ? { ...reg.config } : undefined;
  }

  getLanguageIdForFile(filePath: string): string | undefined {
    const reg = this.getRegistrationForFile(filePath);
    return reg?.languageId;
  }

  getRegistrationForFile(
    filePath: string
  ): LanguageServerRegistration | undefined {
    const ext = this.getFileExtension(filePath);
    if (!ext) return undefined;

    const lang = this.extensionIndex.get(ext);
    return lang ? this.registrations.get(lang) : undefined;
  }

  getRegistration(language: string): LanguageServerRegistration | undefined {
    return this.registrations.get(language);
  }

  getAllLanguages(): string[] {
    return Array.from(this.registrations.keys());
  }

  getAllRegistrations(): LanguageServerRegistration[] {
    return Array.from(this.registrations.values());
  }

  getExtensionsForLanguage(language: string): string[] {
    const reg = this.registrations.get(language);
    return reg ? [...reg.extensions] : [];
  }

  getSupportedExtensions(): string[] {
    return Array.from(this.extensionIndex.keys());
  }

  private getFileExtension(filePath: string): string | undefined {
    const fileName = filePath.split(/[/\\]/).pop() || '';
    if (fileName === 'Dockerfile') return 'dockerfile';

    const dotIndex = fileName.lastIndexOf('.');
    if (dotIndex < 0) {
      return fileName === 'Dockerfile' ? 'dockerfile' : undefined;
    }
    return fileName.slice(dotIndex).toLowerCase();
  }
}

let defaultRegistry: LSPServerConfigRegistry | undefined;

export function getDefaultConfigRegistry(): LSPServerConfigRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new LSPServerConfigRegistry();
  }
  return defaultRegistry;
}

export function createConfigRegistry(
  customServers?: LanguageServerRegistration[]
): LSPServerConfigRegistry {
  return new LSPServerConfigRegistry(customServers);
}
