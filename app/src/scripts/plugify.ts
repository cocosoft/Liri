#!/usr/bin/env bun
/**
 * plugify 脚手架
 * 自动将模块包装为标准插件，生成 Plugin 包装器和契约测试
 *
 * 用法: bun run src/scripts/plugify.ts <模块名> [描述]
 * 示例: bun run src/scripts/plugify.ts canvas "画布工具模块插件"
 */
import fs from 'node:fs';
import path from 'path';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('plugify');

const TEMPLATES_DIR = path.join(
  import.meta.dirname,
  '..',
  'plugins',
  'bundled'
);

/**
 * 将模块名转为帕斯卡命名
 */
function toPascalCase(name: string): string {
  return name
    .replace(/[-_]/g, ' ')
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

/**
 * 将模块名转为驼峰命名
 */
function toCamelCase(name: string): string {
  const pascal = toPascalCase(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * 生成 Plugin 包装器代码
 */
function generatePluginCode(moduleName: string, description: string): string {
  const PluginClass = toPascalCase(moduleName) + 'Plugin';
  const pluginId = moduleName.toLowerCase();
  const varName = toCamelCase(moduleName);

  return `/**
 * ${PluginClass}
 * 将 ${moduleName} 模块包装为标准 Plugin，使用 IPluginAPI 访问内核服务
 */
import type { Plugin, PluginMetadata } from '../types';
import { PluginStatus } from '../types/Plugin.js';
import type { IPluginAPI } from '../api/PluginAPI.js';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('plugify');

/**
 * ${PluginClass} 元数据
 */
export const ${PluginClass}Metadata: PluginMetadata = {
  id: '${pluginId}',
  name: '${toPascalCase(moduleName)}',
  version: '1.0.0',
  description: '${description}',
  author: 'Liri Team',
  category: 'feature',
  dependencies: [],
  enabledByDefault: true,
};

/**
 * ${PluginClass} 实现对 ${moduleName} 模块的包装
 */
export class ${PluginClass} implements Plugin {
  status: PluginStatus = PluginStatus.ENABLED;
  private enabled = true;
  private _api: IPluginAPI | null = null;

  get metadata(): PluginMetadata {
    return ${PluginClass}Metadata;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setAPI(api: IPluginAPI): void {
    this._api = api;
  }

  getAPI(): IPluginAPI | null {
    return this._api;
  }

  async initialize(): Promise<void> {
    logger.info(\`[${PluginClass}] 初始化\`);
  }

  async activate(): Promise<void> {
    this.enabled = true;
    logger.info(\`[${PluginClass}] 已激活\`);

    if (this._api) {
      this._api.commands.registerCommand('${pluginId}.status', async () => {
        return this.getStatus();
      });

      logger.info(\`[${PluginClass}] 已注册 ${pluginId}.status 命令\`);
    }
  }

  async deactivate(): Promise<void> {
    this.enabled = false;
    logger.info(\`[${PluginClass}] 已停用\`);
  }

  async dispose(): Promise<void> {
    this._api = null;
    logger.info(\`[${PluginClass}] 已释放\`);
  }

  /**
   * 获取插件状态
   */
  getStatus(): string {
    const apiInfo = this._api ? '已连接 PluginAPI' : '未连接 PluginAPI';
    return \`${PluginClass} 状态: \${apiInfo}\`;
  }
}

/**
 * 创建 ${PluginClass} 实例
 */
export function create${PluginClass}(): ${PluginClass} {
  return new ${PluginClass}();
}
`;
}

/**
 * 生成契约测试代码
 */
function generateTestCode(moduleName: string, description: string): string {
  const PluginClass = toPascalCase(moduleName) + 'Plugin';
  const pluginId = moduleName.toLowerCase();

  return `/**
 * ${PluginClass} 契约测试
 * 验证：
 * 1. 元数据和插件接口遵循标准 Plugin 契约
 * 2. 完整生命周期（initialize/activate/deactivate/dispose）
 * 3. IPluginAPI 注入和工作
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  ${PluginClass},
  ${PluginClass}Metadata,
  create${PluginClass},
} from './${PluginClass}';
import { PluginAPIImpl, createPluginAPI } from '../api/PluginAPI';
import {
  KernelServiceRegistry,
  KernelServiceId,
  getKernelServiceRegistry,
  resetKernelServiceRegistry,
} from '../api/KernelServiceRegistry';

describe('${PluginClass} — 元数据', () => {
  let plugin: ${PluginClass};

  beforeEach(() => {
    plugin = create${PluginClass}();
  });

  it('应具有正确的元数据', () => {
    expect(plugin.metadata.id).toBe('${pluginId}');
    expect(plugin.metadata.name).toBe('${toPascalCase(moduleName)}');
    expect(plugin.metadata.version).toBe('1.0.0');
    expect(plugin.metadata.description).toContain('${description}');
    expect(plugin.metadata.enabledByDefault).toBe(true);
  });

  it('应匹配导出的 ${PluginClass}Metadata', () => {
    expect(plugin.metadata).toEqual(${PluginClass}Metadata);
  });
});

describe('${PluginClass} — 生命周期', () => {
  let plugin: ${PluginClass};

  beforeEach(() => {
    plugin = create${PluginClass}();
  });

  it('初始状态应已启用', () => {
    expect(plugin.isEnabled).toBe(true);
    expect(plugin.status).toBeDefined();
  });

  it('应能执行完整生命周期', async () => {
    await expect(plugin.initialize()).resolves.toBeUndefined();
    await expect(plugin.activate()).resolves.toBeUndefined();
    await expect(plugin.deactivate()).resolves.toBeUndefined();
    await expect(plugin.dispose()).resolves.toBeUndefined();
  });

  it('停用后 isEnabled 应为 false', async () => {
    await plugin.activate();
    expect(plugin.isEnabled).toBe(true);

    await plugin.deactivate();
    expect(plugin.isEnabled).toBe(false);
  });

  it('释放后 setAPI 不应抛出错误', () => {
    plugin.setAPI(createPluginAPI('test'));
    plugin.dispose();
    expect(plugin.getAPI()).toBeNull();
  });
});

describe('${PluginClass} — IPluginAPI 集成', () => {
  let plugin: ${PluginClass};
  let registry: KernelServiceRegistry;
  let api: PluginAPIImpl;

  beforeEach(() => {
    resetKernelServiceRegistry();
    registry = getKernelServiceRegistry();
    registry.register(KernelServiceId.PLUGIN_LOADER, { id: 'loader' });
    registry.grantAccess('${pluginId}', [KernelServiceId.PLUGIN_LOADER]);

    api = new PluginAPIImpl('${pluginId}', registry);
    plugin = create${PluginClass}();
    plugin.setAPI(api);
  });

  it('setAPI 应正确注入 API 实例', () => {
    expect(plugin.getAPI()).toBe(api);
  });

  it('激活后应注册 ${pluginId}.status 命令', async () => {
    await plugin.activate();
    const commands = api.getRegisteredCommands();
    expect(commands).toContain('${pluginId}.status');
  });

  it('${pluginId}.status 命令应返回状态信息', async () => {
    await plugin.activate();
    const result = await api.commands.executeCommand('${pluginId}.status');
    expect(result).toContain('${PluginClass}');
  });
});

describe('${PluginClass} — 基本功能', () => {
  let plugin: ${PluginClass};

  beforeEach(() => {
    plugin = create${PluginClass}();
  });

  it('getStatus 应返回状态摘要', () => {
    const result = plugin.getStatus();
    expect(typeof result).toBe('string');
    expect(result).toContain('${PluginClass}');
  });
});
`;
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    logger.error('用法错误：缺少模块名参数');
    console.error('用法: bun run src/scripts/plugify.ts <模块名> [描述]');
    console.error(
      '示例: bun run src/scripts/plugify.ts canvas "画布工具模块插件"'
    );
    process.exit(1);
  }

  const moduleName = args[0];
  const description = args[1] || `${moduleName} 模块插件`;

  const PluginClass = toPascalCase(moduleName) + 'Plugin';
  const pluginPath = path.join(TEMPLATES_DIR, `${PluginClass}.ts`);
  const testPath = path.join(TEMPLATES_DIR, `${PluginClass}.test.ts`);

  // 检查是否已存在
  if (fs.existsSync(pluginPath)) {
    logger.error('插件文件已存在', { pluginPath });
    console.error(`错误: ${pluginPath} 已存在`);
    process.exit(1);
  }

  // 写入 Plugin 文件
  const pluginCode = generatePluginCode(moduleName, description);
  fs.writeFileSync(pluginPath, pluginCode, 'utf-8');
  console.log(`✅ 已生成: ${pluginPath}`);

  // 写入测试文件
  const testCode = generateTestCode(moduleName, description);
  fs.writeFileSync(testPath, testCode, 'utf-8');
  console.log(`✅ 已生成: ${testPath}`);

  console.log();
  console.log('下一步:');
  console.log(`  1. 编辑 ${PluginClass}.ts 添加实际功能`);
  console.log(`  2. 在 BundledPluginManager.ts 中注册`);
  console.log(`  3. 编辑 ${PluginClass}.test.ts 添加功能测试`);
  console.log(`  4. 运行 bun test src/plugins/bundled/${PluginClass}.test.ts`);
}

main();
