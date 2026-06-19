// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 文件化记忆系统（Memdir）导出文件
 */

import {
  MemdirService,
  type MemoryFile,
  type MemoryType,
  type MemoryLayer,
  type MemdirConfig,
  type EntrypointTruncation,
} from './MemdirService';
import {
  MemdirMemoryScanner,
  type MemoryScanResult,
  type RelevantMemoryResult,
  type MemoryAgingConfig,
} from './MemoryScanner';
import {
  MemoryCommands,
  type MemoryCommandOptions,
  type MemoryCommandResult,
  type AutoMemoryConfig,
} from './MemoryCommands';
import {
  MemoryIntegrationService,
  type IntegratedMemory,
  type MemoryIntegrationConfig,
} from './MemoryIntegrationService';

export {
  MemdirService,
  MemoryFile,
  MemoryType,
  MemoryLayer,
  MemdirConfig,
  EntrypointTruncation,
};
export {
  MemdirMemoryScanner,
  MemoryScanResult,
  RelevantMemoryResult,
  MemoryAgingConfig,
};
export {
  MemoryCommands,
  MemoryCommandOptions,
  MemoryCommandResult,
  AutoMemoryConfig,
};
export { MemoryIntegrationService, IntegratedMemory, MemoryIntegrationConfig };

/**
 * 创建默认的记忆集成服务实例
 */
export function createDefaultMemoryIntegrationService(): {
  memdirService: MemdirService;
  memoryScanner: MemdirMemoryScanner;
  memoryCommands: MemoryCommands;
  integrationService: MemoryIntegrationService;
} {
  const memdirService = new MemdirService();
  const memoryScanner = new MemdirMemoryScanner();
  const memoryCommands = new MemoryCommands(memdirService, memoryScanner);
  const integrationService = new MemoryIntegrationService(
    memdirService,
    memoryScanner,
    memoryCommands
  );

  return {
    memdirService,
    memoryScanner,
    memoryCommands,
    integrationService,
  };
}

/**
 * 记忆系统工具函数
 */
export const MemoryUtils = {
  /**
   * 格式化记忆大小
   */
  formatMemorySize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  },

  /**
   * 计算记忆年龄
   */
  calculateMemoryAge(createdAt: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - createdAt.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return '今天';
    if (diffDays === 1) return '昨天';
    if (diffDays < 7) return `${diffDays}天前`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}月前`;
    return `${Math.floor(diffDays / 365)}年前`;
  },

  /**
   * 提取记忆关键词
   */
  extractKeywords(text: string, maxKeywords = 10): string[] {
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2);

    const frequency: Record<string, number> = {};

    for (const word of words) {
      frequency[word] = (frequency[word] || 0) + 1;
    }

    return Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxKeywords)
      .map(([word]) => word);
  },

  /**
   * 验证记忆内容
   */
  validateMemoryContent(content: string): { valid: boolean; error?: string } {
    if (!content || content.trim().length === 0) {
      return { valid: false, error: '记忆内容不能为空' };
    }

    if (content.length > 10000) {
      return { valid: false, error: '记忆内容过长（最大10000字符）' };
    }

    return { valid: true };
  },
};

/**
 * 记忆系统常量
 */
export const MemoryConstants = {
  // 记忆类型
  MEMORY_TYPES: ['user', 'feedback', 'project', 'reference'] as const,

  // 记忆层级
  MEMORY_LAYERS: ['project', 'local', 'automem', 'teammem', 'user'] as const,

  // 默认配置
  DEFAULT_CONFIG: {
    maxEntrypointLines: 200,
    maxEntrypointBytes: 25000,
    maxMemoryCount: 1000,
    memoryTTL: 30 * 24 * 60 * 60 * 1000, // 30天
    autoUpdateInterval: 24 * 60 * 60 * 1000, // 24小时
  },

  // 文件扩展名
  MEMORY_FILE_EXTENSIONS: ['.md', '.txt', '.memory'],

  // 支持的编码
  SUPPORTED_ENCODINGS: ['utf-8', 'utf-16', 'ascii'],
};

/**
 * 记忆系统版本信息
 */
export const MemorySystemInfo = {
  version: '1.0.0',
  basedOn: 'CC源码 memdir 系统',
  features: [
    '分层记忆模型（5层）',
    '文件化记忆存储',
    '记忆检索和扫描',
    '记忆老化管理',
    '自动记忆更新',
    '集成数据库记忆',
  ],
  supportedPlatforms: ['windows', 'macos', 'linux'],
};

export default {
  createDefaultMemoryIntegrationService,
  MemoryUtils,
  MemoryConstants,
  MemorySystemInfo,
};
