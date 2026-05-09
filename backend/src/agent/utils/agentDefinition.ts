/**
 * Agent定义文件格式解析
 */

export interface AgentDefinitionFile {
  name: string;
  description: string;
  type: string;
  version: string;
  config: AgentConfig;
  tools?: string[];
  memory?: MemoryConfig;
}

export interface AgentConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

export interface MemoryConfig {
  enabled: boolean;
  retentionDays?: number;
}

/**
 * 解析YAML格式的Agent定义文件
 */
export function parseYAML(content: string): AgentDefinitionFile | null {
  try {
    const lines = content.trim().split('\n');
    const result: Partial<AgentDefinitionFile> = {
      config: {} as AgentConfig,
    };

    let currentSection: string | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // 跳过注释和空行
      if (trimmed.startsWith('#') || trimmed === '') {
        continue;
      }

      // 检查section
      if (trimmed.startsWith('-')) {
        // 数组项
        const value = parseValue(trimmed.substring(1).trim());
        if (currentSection === 'tools') {
          if (!result.tools) {
            result.tools = [];
          }
          result.tools.push(value as string);
        }
      } else if (trimmed.includes(':')) {
        const [keyPart, valuePart] = trimmed.split(':', 2);
        const key = keyPart.trim();
        const value = valuePart ? valuePart.trim() : '';

        // 检查是否进入新section
        if (key === 'config') {
          currentSection = 'config';
        } else if (key === 'memory') {
          currentSection = 'memory';
        } else if (key === 'tools') {
          currentSection = 'tools';
        } else if (currentSection === 'config') {
          // 在config section中
          (result.config as Record<string, any>)[key] = parseValue(value);
        } else if (currentSection === 'memory') {
          // 在memory section中
          if (!result.memory) {
            result.memory = {} as MemoryConfig;
          }
          (result.memory as Record<string, any>)[key] = parseValue(value);
        } else {
          // 顶级字段
          (result as Record<string, any>)[key] = parseValue(value);
        }
      }
    }

    // 验证必要字段
    if (
      !result.name ||
      !result.type ||
      !result.version ||
      !result.config?.model
    ) {
      return null;
    }

    return result as AgentDefinitionFile;
  } catch {
    return null;
  }
}

/**
 * 解析JSON格式的Agent定义文件
 */
export function parseJSON(content: string): AgentDefinitionFile | null {
  try {
    const parsed = JSON.parse(content);

    // 验证必要字段
    if (
      !parsed.name ||
      !parsed.type ||
      !parsed.version ||
      !parsed.config?.model
    ) {
      return null;
    }

    return parsed as AgentDefinitionFile;
  } catch {
    return null;
  }
}

/**
 * 解析值（处理YAML的类型转换）
 */
function parseValue(value: string): string | number | boolean {
  if (value === '') {
    return '';
  }

  // 尝试解析数字
  if (!isNaN(Number(value))) {
    return Number(value);
  }

  // 尝试解析布尔值
  if (value.toLowerCase() === 'true') {
    return true;
  }
  if (value.toLowerCase() === 'false') {
    return false;
  }

  // 移除引号
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.substring(1, value.length - 1);
  }

  return value;
}

/**
 * 验证Agent定义文件
 */
export function validateAgentDefinition(def: AgentDefinitionFile): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!def.name) {
    errors.push('name is required');
  }

  if (!def.type) {
    errors.push('type is required');
  }

  if (!def.version) {
    errors.push('version is required');
  }

  if (!def.config) {
    errors.push('config is required');
  } else if (!def.config.model) {
    errors.push('config.model is required');
  }

  if (
    def.config.temperature !== undefined &&
    (def.config.temperature < 0 || def.config.temperature > 1)
  ) {
    errors.push('temperature must be between 0 and 1');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
