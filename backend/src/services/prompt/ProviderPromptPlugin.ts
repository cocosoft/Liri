/**
 * 提供者提示插件机制
 * 允许 AI 提供商注册自定义提示段落覆盖
 * 不同模型/提供商可针对自家模型微调特定段落风格
 */

import {
  getRegisteredSections,
  type SystemPromptSection,
} from '@modules/constants/systemPromptSections';

/**
 * 提供者可覆盖的段落名称集合
 */
export const OVERRIDABLE_SECTIONS = ['interactionStyle', 'toolUse'] as const;

export type OverridableSection = (typeof OVERRIDABLE_SECTIONS)[number];

/**
 * 提供者提示插件
 * 提供商可实现此接口来贡献自定义提示段落
 */
export interface ProviderPromptPlugin {
  /** 提供商 ID（与 ProviderRegistry 中的 id 匹配） */
  providerId: string;
  /** 插件优先级，数值越高越优先。默认 0 */
  priority: number;
  /** 获取要覆盖的段落映射 */
  getSectionOverrides(): Map<OverridableSection, SystemPromptSection>;
}

/**
 * 提供者提示插件注册表
 */
class ProviderPromptRegistry {
  private plugins = new Map<string, ProviderPromptPlugin>();

  register(plugin: ProviderPromptPlugin): void {
    this.plugins.set(plugin.providerId, plugin);
  }

  unregister(providerId: string): void {
    this.plugins.delete(providerId);
  }

  get(providerId: string): ProviderPromptPlugin | undefined {
    return this.plugins.get(providerId);
  }

  has(providerId: string): boolean {
    return this.plugins.has(providerId);
  }

  list(): ProviderPromptPlugin[] {
    return Array.from(this.plugins.values());
  }

  clear(): void {
    this.plugins.clear();
  }

  /**
   * 获取指定提供商的段落覆盖
   * 返回合并后的段落列表：将原始段落中可覆盖的部分替换为提供商版本
   */
  applyOverrides(
    providerId: string | undefined,
    sections?: SystemPromptSection[]
  ): SystemPromptSection[] {
    const target = sections ?? getRegisteredSections();

    if (!providerId || !this.plugins.has(providerId)) {
      return target;
    }

    const plugin = this.plugins.get(providerId)!;
    const overrides = plugin.getSectionOverrides();
    const sectionMap = new Map(target.map((s) => [s.name, s]));

    for (const [sectionName, overrideSection] of overrides) {
      if (sectionMap.has(sectionName)) {
        sectionMap.set(sectionName, overrideSection);
      }
    }

    return Array.from(sectionMap.values());
  }
}

export const providerPromptRegistry = new ProviderPromptRegistry();

/**
 * 创建简单的提供者提示插件辅助函数
 */
export function createProviderPromptPlugin(
  providerId: string,
  overrides: Map<OverridableSection, SystemPromptSection>,
  priority: number = 0
): ProviderPromptPlugin {
  return {
    providerId,
    priority,
    getSectionOverrides: () => overrides,
  };
}
