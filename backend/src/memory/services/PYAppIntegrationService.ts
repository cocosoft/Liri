import * as fs from 'fs';
import * as path from 'path';

/**
 * PY_APP.md规则类型
 */
export interface Rule {
  id: string;
  category: string;
  content: string;
  priority: 'high' | 'medium' | 'low';
}

/**
 * PY_APP.md偏好设置
 */
export interface Preference {
  key: string;
  value: string | boolean | number;
  description?: string;
}

/**
 * PY_APP.md配置信息
 */
export interface PYAppConfig {
  rules: Rule[];
  preferences: Preference[];
  lastModified: Date;
  filePath: string;
}

/**
 * PY_APP.md集成服务
 * 负责解析PY_APP.md文件，提取规则和偏好设置
 */
export class PYAppIntegrationService {
  private config: PYAppConfig | null = null;
  private filePath: string;
  private lastFileModified: Date = new Date(0);
  private watcher: fs.FSWatcher | null = null;
  private changeListeners: Array<(config: PYAppConfig) => void> = [];

  /**
   * 构造函数
   * @param filePath PY_APP.md文件路径，默认为项目根目录下的PY_APP.md
   */
  constructor(filePath: string = './PY_APP.md') {
    this.filePath = path.resolve(filePath);
  }

  /**
   * 初始化服务
   */
  async initialize(): Promise<void> {
    await this.loadConfig();
    this.startWatcher();
  }

  /**
   * 加载配置
   */
  async loadConfig(): Promise<void> {
    try {
      if (await this.fileExists(this.filePath)) {
        const stats = await fs.promises.stat(this.filePath);
        this.lastFileModified = stats.mtime;
        
        const content = await fs.promises.readFile(this.filePath, 'utf-8');
        this.config = this.parsePYAppContent(content, this.filePath, this.lastFileModified);
      } else {
        this.config = {
          rules: [],
          preferences: [],
          lastModified: new Date(0),
          filePath: this.filePath,
        };
      }
    } catch (error) {
      console.warn(`Failed to load PY_APP.md: ${error}`);
      this.config = {
        rules: [],
        preferences: [],
        lastModified: new Date(0),
        filePath: this.filePath,
      };
    }
  }

  /**
   * 检查文件是否存在
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 解析PY_APP.md内容
   */
  private parsePYAppContent(
    content: string,
    filePath: string,
    lastModified: Date
  ): PYAppConfig {
    const rules: Rule[] = [];
    const preferences: Preference[] = [];

    const lines = content.split('\n');
    let currentSection = '';
    let currentRuleContent = '';
    let currentRuleCategory = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 检测章节标题
      if (line.startsWith('## ')) {
        // 如果有未完成的规则，先保存
        if (currentRuleContent && currentRuleCategory) {
          rules.push({
            id: this.generateRuleId(currentRuleCategory, rules.length),
            category: currentRuleCategory,
            content: currentRuleContent.trim(),
            priority: this.determinePriority(currentRuleContent),
          });
          currentRuleContent = '';
        }

        currentSection = line.substring(3).trim();
        currentRuleCategory = currentSection;
      }
      // 检测列表项
      else if (line.startsWith('- ') || line.startsWith('* ')) {
        const itemContent = line.substring(2).trim();
        
        // 尝试解析偏好设置（格式: key: value - description）
        const preferenceMatch = itemContent.match(/^([^:]+):\s*([^-]+?)\s*(-\s*.+)?$/);
        if (preferenceMatch) {
          const key = preferenceMatch[1].trim();
          let value = preferenceMatch[2].trim();
          const description = preferenceMatch[3]?.substring(1).trim();

          // 尝试解析值类型
          if (value.toLowerCase() === 'true') {
            value = true;
          } else if (value.toLowerCase() === 'false') {
            value = false;
          } else if (!isNaN(parseFloat(value))) {
            value = parseFloat(value);
          }

          preferences.push({
            key,
            value,
            description,
          });
        } else {
          // 作为规则内容
          if (currentRuleCategory) {
            if (currentRuleContent) {
              currentRuleContent += '\n';
            }
            currentRuleContent += itemContent;
          }
        }
      }
      // 普通文本内容
      else if (currentRuleCategory && line.trim()) {
        if (currentRuleContent) {
          currentRuleContent += '\n';
        }
        currentRuleContent += line.trim();
      }
    }

    // 保存最后一个规则
    if (currentRuleContent && currentRuleCategory) {
      rules.push({
        id: this.generateRuleId(currentRuleCategory, rules.length),
        category: currentRuleCategory,
        content: currentRuleContent.trim(),
        priority: this.determinePriority(currentRuleContent),
      });
    }

    return {
      rules,
      preferences,
      lastModified,
      filePath,
    };
  }

  /**
   * 生成规则ID
   */
  private generateRuleId(category: string, index: number): string {
    const categorySlug = category.toLowerCase().replace(/\s+/g, '-');
    return `${categorySlug}-${index + 1}`;
  }

  /**
   * 根据内容确定优先级
   */
  private determinePriority(content: string): 'high' | 'medium' | 'low' {
    if (content.includes('必须') || content.includes('严禁') || content.includes('重要')) {
      return 'high';
    }
    if (content.includes('建议') || content.includes('应该') || content.includes('推荐')) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * 启动文件监听器
   */
  private startWatcher(): void {
    if (this.watcher) {
      this.watcher.close();
    }

    this.watcher = fs.watch(this.filePath, async (eventType) => {
      if (eventType === 'change') {
        await this.handleFileChange();
      }
    });
  }

  /**
   * 处理文件变化
   */
  private async handleFileChange(): Promise<void> {
    try {
      const stats = await fs.promises.stat(this.filePath);
      if (stats.mtime.getTime() > this.lastFileModified.getTime()) {
        await this.loadConfig();
        this.notifyChangeListeners();
      }
    } catch (error) {
      console.warn(`Error handling PY_APP.md change: ${error}`);
    }
  }

  /**
   * 添加变化监听器
   */
  addChangeListener(listener: (config: PYAppConfig) => void): void {
    this.changeListeners.push(listener);
  }

  /**
   * 移除变化监听器
   */
  removeChangeListener(listener: (config: PYAppConfig) => void): void {
    const index = this.changeListeners.indexOf(listener);
    if (index > -1) {
      this.changeListeners.splice(index, 1);
    }
  }

  /**
   * 通知所有变化监听器
   */
  private notifyChangeListeners(): void {
    if (this.config) {
      for (const listener of this.changeListeners) {
        try {
          listener(this.config);
        } catch (error) {
          console.warn(`Error in change listener: ${error}`);
        }
      }
    }
  }

  /**
   * 获取配置
   */
  getConfig(): PYAppConfig | null {
    return this.config;
  }

  /**
   * 获取所有规则
   */
  getRules(): Rule[] {
    return this.config?.rules || [];
  }

  /**
   * 获取指定类别的规则
   */
  getRulesByCategory(category: string): Rule[] {
    return this.config?.rules.filter((r) => r.category === category) || [];
  }

  /**
   * 获取指定优先级的规则
   */
  getRulesByPriority(priority: 'high' | 'medium' | 'low'): Rule[] {
    return this.config?.rules.filter((r) => r.priority === priority) || [];
  }

  /**
   * 获取所有偏好设置
   */
  getPreferences(): Preference[] {
    return this.config?.preferences || [];
  }

  /**
   * 获取指定键的偏好设置
   */
  getPreference(key: string): Preference | undefined {
    return this.config?.preferences.find((p) => p.key === key);
  }

  /**
   * 获取偏好设置值
   */
  getPreferenceValue(key: string, defaultValue?: any): any {
    const preference = this.getPreference(key);
    return preference?.value ?? defaultValue;
  }

  /**
   * 检查规则是否变更
   */
  async checkForChanges(): Promise<boolean> {
    if (!await this.fileExists(this.filePath)) {
      return false;
    }

    const stats = await fs.promises.stat(this.filePath);
    return stats.mtime.getTime() > this.lastFileModified.getTime();
  }

  /**
   * 获取规则文本（用于AI模块）
   */
  getRulesText(): string {
    if (!this.config || this.config.rules.length === 0) {
      return '';
    }

    const rulesByCategory: Record<string, Rule[]> = {};
    for (const rule of this.config.rules) {
      if (!rulesByCategory[rule.category]) {
        rulesByCategory[rule.category] = [];
      }
      rulesByCategory[rule.category].push(rule);
    }

    let text = '';
    for (const [category, rules] of Object.entries(rulesByCategory)) {
      text += `## ${category}\n\n`;
      for (const rule of rules) {
        const priorityMarker = rule.priority === 'high' ? '⚠️' : rule.priority === 'medium' ? 'ℹ️' : '💡';
        text += `${priorityMarker} ${rule.content}\n\n`;
      }
    }

    return text.trim();
  }

  /**
   * 清理资源
   */
  dispose(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.changeListeners = [];
  }
}

/**
 * 创建PY_APP.md集成服务实例
 */
export function createPYAppIntegrationService(
  filePath?: string
): PYAppIntegrationService {
  return new PYAppIntegrationService(filePath);
}

/**
 * 全局PY_APP.md集成服务实例
 */
export const pyAppIntegrationService = createPYAppIntegrationService();
