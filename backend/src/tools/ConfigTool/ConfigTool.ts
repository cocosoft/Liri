// @ts-nocheck
/**
 * ConfigTool
 *
 * 通过工具接口管理应用配置，支持读取、设置、删除配置项
 */

import { BaseTool } from '../BaseTool';
import { getConfig, getConfigValue, setConfigValue, resetConfigToDefaults } from '../../config';
import type { ToolContext, ToolResult } from '../../types';

export interface ConfigToolInput {
  action: 'get' | 'set' | 'delete' | 'list';
  key?: string;
  value?: any;
}

export class ConfigTool extends BaseTool<ConfigToolInput> {
  name = 'config';
  description = 'Manage application configuration';

  async execute(
    input: ConfigToolInput,
    context: ToolContext
  ): Promise<ToolResult> {
    switch (input.action) {
      case 'get':
        return this.getConfig(input.key!);
      case 'set':
        return this.setConfig(input.key!, input.value);
      case 'delete':
        return this.deleteConfig(input.key!);
      case 'list':
        return this.listConfig();
      default:
        return {
          success: false,
          error: 'Invalid action',
        };
    }
  }

  private async getConfig(key: string): Promise<ToolResult> {
    try {
      const value = getConfigValue(key);
      return {
        success: true,
        output: value,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  private async setConfig(key: string, value: any): Promise<ToolResult> {
    try {
      setConfigValue(key, value);
      return {
        success: true,
        output: `Set ${key} = ${value}`,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  private async deleteConfig(key: string): Promise<ToolResult> {
    try {
      setConfigValue(key, undefined);
      return {
        success: true,
        output: `Deleted ${key}`,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  private async listConfig(): Promise<ToolResult> {
    try {
      const allConfig = getConfig();
      return {
        success: true,
        output: JSON.stringify(allConfig, null, 2),
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * 检查工具是否启用
   */
  isEnabled(): boolean {
    return true;
  }
}