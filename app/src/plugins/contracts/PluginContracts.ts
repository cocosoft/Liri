/**
 * 插件契约系统
 * 定义每个插件分类的接口契约，插件必须满足对应契约才能激活
 * 对齐 OpenClaw plugins/contracts/ 设计
 */

import { Logger, LogLevel } from '@modules/monitoring';
import {
  PLUGIN_CATEGORIES,
  validatePluginInterfaces,
} from '@modules/plugins/categories/PluginCategories';
import type { PluginCapability } from '@modules/plugins/categories/PluginCategories';

const logger = new Logger({ level: LogLevel.INFO });

export interface PluginContract {
  capability: PluginCapability;
  version: string;
  interfaces: string[];
  metadata: Record<string, unknown>;
  validate: () => ContractValidationResult;
}

export interface ContractValidationResult {
  valid: boolean;
  capability: PluginCapability;
  warnings: string[];
  errors: string[];
  missingInterfaces: string[];
}

export class PluginContractValidator {
  private contracts: Map<string, PluginContract> = new Map();

  registerContract(pluginId: string, contract: PluginContract): void {
    this.contracts.set(pluginId, contract);
    logger.info(
      `注册插件契约: ${pluginId} (${contract.capability}, v${contract.version})`
    );
  }

  unregisterContract(pluginId: string): void {
    this.contracts.delete(pluginId);
  }

  validatePlugin(
    pluginId: string,
    capability: PluginCapability,
    implementedInterfaces: string[]
  ): ContractValidationResult {
    const contract = this.contracts.get(pluginId);
    const warnings: string[] = [];
    const errors: string[] = [];

    const interfaceCheck = validatePluginInterfaces(
      capability,
      implementedInterfaces
    );

    if (!interfaceCheck.valid) {
      errors.push(`缺少必需的接口: ${interfaceCheck.missing.join(', ')}`);
    }

    if (contract && contract.metadata['minVersion']) {
      warnings.push(`最低版本要求: ${contract.metadata['minVersion']}`);
    }

    return {
      valid: errors.length === 0,
      capability,
      warnings,
      errors,
      missingInterfaces: interfaceCheck.missing,
    };
  }

  validateAll(
    plugins: Array<{ id: string; capability: string; interfaces: string[] }>
  ): ContractValidationResult[] {
    return plugins.map((p) =>
      this.validatePlugin(p.id, p.capability as PluginCapability, p.interfaces)
    );
  }

  getContractStats(): { total: number; capabilities: Record<string, number> } {
    const capabilities: Record<string, number> = {};
    for (const [, contract] of this.contracts) {
      capabilities[contract.capability] =
        (capabilities[contract.capability] || 0) + 1;
    }
    return { total: this.contracts.size, capabilities };
  }
}

export const pluginContractValidator = new PluginContractValidator();

export interface ContractAssertion {
  name: string;
  description: string;
  category: PluginCapability;
  validate: (target: unknown) => boolean;
  errorMessage: string;
}

export interface AssertionResult {
  assertion: ContractAssertion;
  passed: boolean;
  error?: string;
}

export interface ContractSuiteResult {
  suiteName: string;
  category: PluginCapability;
  total: number;
  passed: number;
  failed: number;
  results: AssertionResult[];
}

export class ContractSuiteRunner {
  private suites: Map<string, ContractAssertion[]> = new Map();

  registerSuite(suiteName: string, assertions: ContractAssertion[]): void {
    this.suites.set(suiteName, assertions);
  }

  runSuite(
    suiteName: string,
    target: unknown,
    category?: PluginCapability
  ): ContractSuiteResult {
    const assertions = this.suites.get(suiteName);
    if (!assertions) {
      return {
        suiteName,
        category: category || 'tool',
        total: 0,
        passed: 0,
        failed: 0,
        results: [],
      };
    }

    const filtered = category
      ? assertions.filter((a) => a.category === category)
      : assertions;

    const results: AssertionResult[] = filtered.map((a) => {
      try {
        const passed = a.validate(target);
        return {
          assertion: a,
          passed,
          error: passed ? undefined : a.errorMessage,
        };
      } catch (e) {
        return {
          assertion: a,
          passed: false,
          error: `异常: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    });

    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;

    return {
      suiteName,
      category: category || 'tool',
      total: results.length,
      passed,
      failed,
      results,
    };
  }

  getAssertions(suiteName: string): ContractAssertion[] {
    return this.suites.get(suiteName) || [];
  }
}

export const contractSuiteRunner = new ContractSuiteRunner();

export function createCategoryContractAssertions(): ContractAssertion[] {
  return [
    {
      name: 'category-required-interfaces-defined',
      description: '每个分类必须定义 requiredInterfaces',
      category: 'tool',
      validate: () => {
        for (const [, meta] of Object.entries(PLUGIN_CATEGORIES)) {
          if (!Array.isArray(meta.requiredInterfaces)) return false;
        }
        return true;
      },
      errorMessage: '存在分类缺少 requiredInterfaces 定义',
    },
    {
      name: 'category-capability-exists',
      description: 'PLUGIN_CATEGORIES 中的键必须对应有效的 PluginCapability',
      category: 'tool',
      validate: () => {
        const capabilities = Object.keys(PLUGIN_CATEGORIES);
        for (const key of capabilities) {
          if (!key) return false;
        }
        return capabilities.length > 0;
      },
      errorMessage: 'PLUGIN_CATEGORIES 为空或包含无效键',
    },
    {
      name: 'category-interface-provider-matches',
      description: 'provider 分类必须声明 IProviderPlugin 为必需接口',
      category: 'provider',
      validate: () => {
        const providerMeta = PLUGIN_CATEGORIES['provider'];
        if (!providerMeta) return false;
        return providerMeta.requiredInterfaces.includes('IProviderPlugin');
      },
      errorMessage: 'provider 分类缺少 IProviderPlugin 必需接口',
    },
    {
      name: 'category-interface-tool-matches',
      description: 'tool 分类必须声明 IToolPlugin 为必需接口',
      category: 'tool',
      validate: () => {
        const toolMeta = PLUGIN_CATEGORIES['tool'];
        if (!toolMeta) return false;
        return toolMeta.requiredInterfaces.includes('IToolPlugin');
      },
      errorMessage: 'tool 分类缺少 IToolPlugin 必需接口',
    },
    {
      name: 'category-interface-channel-matches',
      description: 'channel 分类必须声明 IChannelPlugin 为必需接口',
      category: 'channel',
      validate: () => {
        const channelMeta = PLUGIN_CATEGORIES['channel'];
        if (!channelMeta) return false;
        return channelMeta.requiredInterfaces.includes('IChannelPlugin');
      },
      errorMessage: 'channel 分类缺少 IChannelPlugin 必需接口',
    },
    {
      name: 'validatePluginInterfaces-detects-missing',
      description: 'validatePluginInterfaces 能正确检测缺少接口',
      category: 'tool',
      validate: () => {
        const result = validatePluginInterfaces('tool', []);
        return !result.valid && result.missing.includes('IToolPlugin');
      },
      errorMessage: 'validatePluginInterfaces 未能检测到缺少的 IToolPlugin',
    },
    {
      name: 'validatePluginInterfaces-passes-with-required',
      description: 'validatePluginInterfaces 正确接受完整接口集',
      category: 'tool',
      validate: () => {
        const result = validatePluginInterfaces('tool', ['IToolPlugin']);
        return result.valid && result.missing.length === 0;
      },
      errorMessage:
        'validatePluginInterfaces 未能接受包含 IToolPlugin 的接口集',
    },
    {
      name: 'IProviderPlugin-has-required-methods',
      description: 'IProviderPlugin 接口定义了必要的属性和方法',
      category: 'provider',
      validate: () => {
        const keys = Object.keys({
          capability: 'provider',
          providerName: '',
          getModels: () => [] as string[],
          healthCheck: () => Promise.resolve(true),
        });
        return (
          keys.includes('capability') &&
          keys.includes('providerName') &&
          keys.includes('getModels') &&
          keys.includes('healthCheck')
        );
      },
      errorMessage: 'IProviderPlugin 结构不完整',
    },
    {
      name: 'IToolPlugin-has-required-methods',
      description: 'IToolPlugin 接口定义了必要的属性和方法',
      category: 'tool',
      validate: () => {
        const keys = Object.keys({
          capability: 'tool',
          toolName: '',
          getSchema: () => ({}),
          execute: () => Promise.resolve({}),
        });
        return (
          keys.includes('capability') &&
          keys.includes('toolName') &&
          keys.includes('getSchema') &&
          keys.includes('execute')
        );
      },
      errorMessage: 'IToolPlugin 结构不完整',
    },
    {
      name: 'IChannelPlugin-has-required-methods',
      description: 'IChannelPlugin 接口定义了必要的属性和方法',
      category: 'channel',
      validate: () => {
        const keys = Object.keys({
          capability: 'channel',
          channelName: '',
          connect: () => Promise.resolve(),
          disconnect: () => Promise.resolve(),
          sendMessage: () => Promise.resolve(),
          onMessage: () => {},
        });
        return (
          keys.includes('capability') &&
          keys.includes('channelName') &&
          keys.includes('connect') &&
          keys.includes('disconnect') &&
          keys.includes('sendMessage') &&
          keys.includes('onMessage')
        );
      },
      errorMessage: 'IChannelPlugin 结构不完整',
    },
  ];
}
