import { TOOL_NAME_CONSTANTS } from '@openliri/infra/constants';
/**
 * ConfigTool
 *
 * 通过工具接口管理应用配置，支持读取、设置、删除配置项
 */

import { BaseTool } from '@openliri/tool-base';
import {
  getConfig,
  getConfigValue,
  setConfigValue,
  resetConfigToDefaults,
} from '@openliri/infra/config';
import type { ToolParam } from '@openliri/infra/utils/toolContract';
import { ToolTag } from '@openliri/infra/utils/toolContract/Tool';
import type { ToolUseContext } from '@openliri/infra/utils/toolContract/ToolUseContext';
import type { ToolResult } from '@openliri/infra/utils/toolContract/ToolResult';

import { getLogger } from '@openliri/infra/monitoring';
const logger = getLogger('tools:ConfigTool:ConfigTool');

export interface ConfigToolInput {
  action: 'get' | 'set' | 'delete' | 'list';
  key?: string;
  value?: any;
}

export class ConfigTool extends BaseTool<ConfigToolInput> {
  name = TOOL_NAME_CONSTANTS.config;
  description = 'Manage application configuration';

  override tags = [ToolTag.SYSTEM];

  /**
   * U-03（2026-11-23）：模型可见出参结构。
   * 实测出口：成功 `{success:true, output}`（`get` 为读到的配置值，任意类型；
   * `set`/`delete`/`list` 为回执文本），失败 `{success:false, error}`。
   */
  override outputJsonSchema = {
    type: 'object',
    properties: {
      success: { type: 'boolean', description: '是否成功' },
      output: {
        description:
          'get：读到的配置值（任意类型）；set/delete：操作回执；list：JSON 文本化的全部配置',
      },
      error: { type: 'string', description: '失败原因（失败分支）' },
    },
    required: ['success'],
  };

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      description: 'Action to perform: get, set, delete, list',
      required: true,
    },
    {
      name: 'key',
      type: 'string',
      description: 'Configuration key',
      required: false,
    },
    {
      name: 'value',
      type: 'string',
      description: 'Configuration value',
      required: false,
    },
  ];

  override async execute(
    input: ConfigToolInput,
    context: ToolUseContext
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

  override isEnabled(): boolean {
    return true;
  }
}
