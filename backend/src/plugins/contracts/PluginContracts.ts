/**
 * 插件契约系统
 * 定义每个插件分类的接口契约，插件必须满足对应契约才能激活
 * 对齐 OpenClaw plugins/contracts/ 设计
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { PLUGIN_CATEGORIES, validatePluginInterfaces } from '@modules/plugins/categories/PluginCategories';
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
    logger.info(`注册插件契约: ${pluginId} (${contract.capability}, v${contract.version})`);
  }

  unregisterContract(pluginId: string): void {
    this.contracts.delete(pluginId);
  }

  validatePlugin(pluginId: string, capability: PluginCapability, implementedInterfaces: string[]): ContractValidationResult {
    const contract = this.contracts.get(pluginId);
    const warnings: string[] = [];
    const errors: string[] = [];

    const interfaceCheck = validatePluginInterfaces(capability, implementedInterfaces);

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

  validateAll(plugins: Array<{ id: string; capability: string; interfaces: string[] }>): ContractValidationResult[] {
    return plugins.map((p) =>
      this.validatePlugin(p.id, p.capability as PluginCapability, p.interfaces)
    );
  }

  getContractStats(): { total: number; capabilities: Record<string, number> } {
    const capabilities: Record<string, number> = {};
    for (const [, contract] of this.contracts) {
      capabilities[contract.capability] = (capabilities[contract.capability] || 0) + 1;
    }
    return { total: this.contracts.size, capabilities };
  }
}

export const pluginContractValidator = new PluginContractValidator();
