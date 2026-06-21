/**
 * 规则引擎（RuleEngine）
 *
 * 按专业归口管理规则，执行时自动拼接相关规则。
 *
 * 目录结构：
 * .liri/rules/
 * ├─ all.md           ← 全局规则（所有工作项都加载）
 * ├─ security.md      ← 安全规则（涉及安全相关的工作项加载）
 * ├─ performance.md   ← 性能规则（涉及性能优化的工作项加载）
 * ├─ architecture.md  ← 架构规则（涉及架构变更的工作项加载）
 * ├─ data.md          ← 数据规则（涉及数据库/数据变更的工作项加载）
 * ├─ frontend.md      ← 前端规则（涉及前端代码的工作项加载）
 * ├─ backend.md       ← 后端规则（涉及后端代码的工作项加载）
 * ├─ test.md          ← 测试规则（涉及测试编写的工作项加载）
 * └─ custom/          ← 用户自定义规则
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ module: 'RuleEngine', level: LogLevel.INFO });

/** 专业领域 */
export type RuleSpecialization =
  | 'all'
  | 'security'
  | 'performance'
  | 'architecture'
  | 'data'
  | 'frontend'
  | 'backend'
  | 'test'
  | 'custom';

/** 规则文件映射 */
const SPECIALIZATION_FILES: Record<RuleSpecialization, string> = {
  all: 'all.md',
  security: 'security.md',
  performance: 'performance.md',
  architecture: 'architecture.md',
  data: 'data.md',
  frontend: 'frontend.md',
  backend: 'backend.md',
  test: 'test.md',
  custom: 'custom/',
};

/** 关键词 → 专业领域映射（用于自动判断） */
const KEYWORD_TO_SPECIALIZATION: Array<{
  keywords: RegExp[];
  specialization: RuleSpecialization;
}> = [
  {
    keywords: [/sql|注入|injection|auth|token|password|encrypt|vulnerability/i],
    specialization: 'security',
  },
  {
    keywords: [
      /性能|performance|optimize|优化|慢|slow|latency|N\+1|memory|内存/i,
    ],
    specialization: 'performance',
  },
  {
    keywords: [
      /架构|architecture|refactor|重构|design|模式|pattern|interface|接口/i,
    ],
    specialization: 'architecture',
  },
  {
    keywords: [
      /数据库|database|migration|迁移|schema|CREATE TABLE|ALTER TABLE|data/i,
    ],
    specialization: 'data',
  },
  {
    keywords: [/前端|frontend|UI|component|组件|CSS|style|样式|React|Vue|DOM/i],
    specialization: 'frontend',
  },
  {
    keywords: [
      /后端|backend|API|server|路由|route|controller|service|handler/i,
    ],
    specialization: 'backend',
  },
  {
    keywords: [/测试|test|unit|e2e|integration|spec|mock|stub/i],
    specialization: 'test',
  },
];

/**
 * 规则引擎
 *
 * 按专业归口管理规则，根据工作项上下文自动拼接相关规则。
 */
export class RuleEngine {
  private workspacePath: string;
  private cache: Map<string, { content: string; mtime: number }> = new Map();

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /** 获取 rules 目录路径 */
  private get rulesDir(): string {
    return path.join(this.workspacePath, '.liri', 'rules');
  }

  /** 获取单个规则文件路径 */
  private getRulePath(specialization: RuleSpecialization): string {
    const fileName = SPECIALIZATION_FILES[specialization];
    return path.join(this.rulesDir, fileName);
  }

  /**
   * 读取单个规则文件内容
   */
  readRule(specialization: RuleSpecialization): string | null {
    const filePath = this.getRulePath(specialization);

    try {
      const stat = fs.statSync(filePath);

      // 检查缓存
      const cached = this.cache.get(filePath);
      if (cached && cached.mtime === stat.mtimeMs) {
        return cached.content;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      this.cache.set(filePath, { content, mtime: stat.mtimeMs });
      return content;
    } catch {
      return null;
    }
  }

  /**
   * 写入规则文件
   */
  writeRule(specialization: RuleSpecialization, content: string): void {
    const filePath = this.getRulePath(specialization);

    // 确保目录存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, content, 'utf-8');
    this.cache.delete(filePath);

    logger.info('规则已写入', { specialization, filePath });
  }

  /**
   * 追加规则内容
   */
  appendRule(specialization: RuleSpecialization, content: string): void {
    const existing = this.readRule(specialization) || '';
    const separator = existing ? '\n\n' : '';
    this.writeRule(specialization, existing + separator + content);
  }

  /**
   * 根据工作项标题和描述自动判断需要的专业领域
   */
  detectSpecializations(
    title: string,
    description: string
  ): RuleSpecialization[] {
    const text = `${title} ${description}`;
    const specializations = new Set<RuleSpecialization>();

    // "all" 始终加载
    specializations.add('all');

    for (const { keywords, specialization } of KEYWORD_TO_SPECIALIZATION) {
      if (keywords.some((kw) => kw.test(text))) {
        specializations.add(specialization);
      }
    }

    return [...specializations];
  }

  /**
   * 根据工作项上下文，自动加载并拼接相关规则
   * @param title 工作项标题
   * @param description 工作项描述
   * @param changedFiles 变更文件列表（可选，用于更精确的专业判断）
   * @returns 拼接后的规则文本
   */
  loadRulesForWorkItem(
    title: string,
    description: string,
    changedFiles: string[] = []
  ): string {
    const specializations = this.detectSpecializations(title, description);

    // 根据文件路径补充专业判断
    for (const file of changedFiles) {
      if (/\.(tsx|jsx|css|scss|less)$/.test(file)) {
        specializations.push('frontend');
      }
      if (
        /\/app\/|server|\.(ts|js)$/.test(file) &&
        !/\.(tsx|jsx)$/.test(file)
      ) {
        specializations.push('backend');
      }
      if (/\.test\.|\.spec\.|__tests__/.test(file)) {
        specializations.push('test');
      }
      if (/migration|schema|\.sql$/.test(file)) {
        specializations.push('data');
      }
    }

    // 去重
    const uniqueSpecializations = [...new Set(specializations)];

    // 加载并拼接规则
    const rules: string[] = [];
    for (const spec of uniqueSpecializations) {
      const content = this.readRule(spec);
      if (content) {
        rules.push(`## ${this.getSpecializationLabel(spec)}规则\n\n${content}`);
      }
    }

    logger.info('规则加载完成', {
      title,
      specializations: uniqueSpecializations,
      rulesCount: rules.length,
    });

    return rules.join('\n\n---\n\n');
  }

  /**
   * 列出所有已存在的规则文件
   */
  listRules(): Array<{
    specialization: RuleSpecialization;
    filePath: string;
    exists: boolean;
  }> {
    const rules: Array<{
      specialization: RuleSpecialization;
      filePath: string;
      exists: boolean;
    }> = [];

    for (const spec of Object.keys(
      SPECIALIZATION_FILES
    ) as RuleSpecialization[]) {
      const filePath = this.getRulePath(spec);
      rules.push({
        specialization: spec,
        filePath,
        exists: fs.existsSync(filePath),
      });
    }

    return rules;
  }

  /**
   * 获取所有规则的总览
   */
  getRulesOverview(): string {
    const allRules = this.listRules();
    const existing = allRules.filter((r) => r.exists);
    const missing = allRules.filter((r) => !r.exists);

    const lines: string[] = [];
    lines.push(`# 规则总览（${this.workspacePath}）`);
    lines.push('');

    if (existing.length > 0) {
      lines.push('## 已定义的规则');
      for (const rule of existing) {
        const content = this.readRule(rule.specialization) || '';
        const lineCount = content.split('\n').length;
        lines.push(
          `- **${this.getSpecializationLabel(rule.specialization)}** (${lineCount} 行)`
        );
      }
    }

    if (missing.length > 0) {
      lines.push('');
      lines.push('## 未定义的规则（可扩展）');
      for (const rule of missing) {
        lines.push(`- ${this.getSpecializationLabel(rule.specialization)}`);
      }
    }

    return lines.join('\n');
  }

  /** 获取专业领域的中文标签 */
  private getSpecializationLabel(spec: RuleSpecialization): string {
    const labels: Record<RuleSpecialization, string> = {
      all: '全局',
      security: '安全',
      performance: '性能',
      architecture: '架构',
      data: '数据',
      frontend: '前端',
      backend: '后端',
      test: '测试',
      custom: '自定义',
    };
    return labels[spec];
  }

  /** 清除缓存 */
  clearCache(): void {
    this.cache.clear();
  }
}

/** 全局规则引擎实例（惰性初始化） */
let globalEngine: RuleEngine | null = null;

/**
 * 获取全局规则引擎实例
 */
export function getRuleEngine(workspacePath?: string): RuleEngine {
  if (workspacePath) {
    globalEngine = new RuleEngine(workspacePath);
  }
  if (!globalEngine) {
    throw new Error(
      'RuleEngine 未初始化，请先调用 getRuleEngine(workspacePath)'
    );
  }
  return globalEngine;
}
