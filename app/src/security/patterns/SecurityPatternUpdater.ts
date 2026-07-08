/**
 * 安全模式库更新触发器
 * 对标平安科技：每季度更新 Bash 攻击模式库
 * 对新增攻击模式（如 prompt injection 变种）进行自动扫描和更新
 */
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { resolveDataDir } from '@modules/core';

/**
 * 安全模式库条目
 */
export interface SecurityPatternEntry {
  name: string;
  pattern: string;
  message: string;
  riskLevel: 'low' | 'medium' | 'high';
  behavior: 'allow' | 'deny' | 'ask';
  category: string;
  version: number;
  addedAt: number;
}

/**
 * 模式库更新事件
 */
export interface PatternUpdateEvent {
  type: 'added' | 'updated' | 'removed';
  pattern: SecurityPatternEntry;
  timestamp: number;
}

/**
 * 模式库配置
 */
export interface PatternLibraryConfig {
  libraryDir: string;
  autoUpdateIntervalMs: number;
  maxVersionHistory: number;
  categories: string[];
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: PatternLibraryConfig = {
  libraryDir: path.join(resolveDataDir(), 'security', 'patterns'),
  autoUpdateIntervalMs: 90 * 24 * 3600_000,
  maxVersionHistory: 20,
  categories: [
    'command_injection',
    'prompt_injection',
    'path_traversal',
    'xss',
    'encoding_escape',
    'recursive_injection',
  ],
};

/**
 * 内置默认模式（初始版本）
 */
const BUILTIN_PATTERNS: Omit<SecurityPatternEntry, 'version' | 'addedAt'>[] = [
  {
    name: 'rm_rf_root',
    pattern: 'rm\\\\s+-rf\\\\s+/',
    message: '检测到对根目录的递归删除操作',
    riskLevel: 'high',
    behavior: 'deny',
    category: 'command_injection',
  },
  {
    name: 'chmod_777_root',
    pattern: 'chmod\\\\s+777\\\\s+/',
    message: '检测到对根目录的 777 权限变更',
    riskLevel: 'high',
    behavior: 'deny',
    category: 'command_injection',
  },
  {
    name: 'curl_pipe_sh',
    pattern: 'curl\\\\s+\\\\S+\\\\s*\\\\|\\\\s*(ba)?sh',
    message: '检测到 curl 管道到 shell 的危险模式',
    riskLevel: 'high',
    behavior: 'deny',
    category: 'command_injection',
  },
  {
    name: 'sudo_exec',
    pattern: 'sudo\\\\s+(rm|chmod|chown|mkfs|dd)\\\\s',
    message: '检测到 sudo 执行危险命令',
    riskLevel: 'high',
    behavior: 'deny',
    category: 'command_injection',
  },
  {
    name: 'prompt_ignore_previous',
    pattern:
      '(?:ignore|forget|disregard)\\\\s+(?:all\\\\s+)?(?:previous|prior|above)\\\\s+(?:instructions?|prompts?)',
    message: '检测到提示注入：要求忽略之前的指令',
    riskLevel: 'high',
    behavior: 'deny',
    category: 'prompt_injection',
  },
  {
    name: 'prompt_new_system',
    pattern:
      '(?:new\\\\s+system\\\\s+prompt|override\\\\s+(?:the\\\\s+)?system\\\\s+prompt|you\\\\s+are\\\\s+now)',
    message: '检测到提示注入：尝试覆盖系统指令',
    riskLevel: 'high',
    behavior: 'deny',
    category: 'prompt_injection',
  },
  {
    name: 'prompt_role_override',
    pattern:
      '(?:act\\\\s+as\\\\s+(?:if\\\\s+)?you\\\\s+are|pretend\\\\s+(?:to\\\\s+be|you\\\\s+are)|DAN\\\\s+mode|developer\\\\s+mode)',
    message: '检测到提示注入：角色覆盖尝试',
    riskLevel: 'high',
    behavior: 'deny',
    category: 'prompt_injection',
  },
  {
    name: 'path_traversal_dotdot',
    pattern: '(?:\\.\\.[/\\\\\\\\]){3,}',
    message: '检测到路径遍历攻击（多层 ../)',
    riskLevel: 'high',
    behavior: 'deny',
    category: 'path_traversal',
  },
  {
    name: 'xss_script_tag',
    pattern: '<script[^>]*>[\\\\s\\\\S]*?</script>',
    message: '检测到 XSS 攻击（script 标签）',
    riskLevel: 'high',
    behavior: 'deny',
    category: 'xss',
  },
  {
    name: 'encoding_base64',
    pattern:
      '(?:base64|rot13|hex\\\\s+encode|unicode\\\\s+escape).*(?:decode|decrypt|translate|convert)',
    message: '检测到编码绕过攻击尝试',
    riskLevel: 'medium',
    behavior: 'deny',
    category: 'encoding_escape',
  },
];

/**
 * 安全模式库更新器
 */
export class SecurityPatternUpdater extends EventEmitter {
  private patterns: Map<string, SecurityPatternEntry> = new Map();
  private config: PatternLibraryConfig;
  private versionHistory: Array<{
    version: number;
    timestamp: number;
    changes: string[];
  }> = [];
  private updateTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<PatternLibraryConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadBuiltinPatterns();
  }

  /**
   * 加载内置模式
   */
  private loadBuiltinPatterns(): void {
    const now = Date.now();

    for (const pattern of BUILTIN_PATTERNS) {
      this.patterns.set(pattern.name, {
        ...pattern,
        version: 1,
        addedAt: now,
      });
    }
  }

  /**
   * 添加新模式
   * @param entry 模式条目
   * @returns 模式名称
   */
  addPattern(entry: Omit<SecurityPatternEntry, 'version' | 'addedAt'>): string {
    const existing = this.patterns.get(entry.name);
    const version = existing ? existing.version + 1 : 1;

    const pattern: SecurityPatternEntry = {
      ...entry,
      version,
      addedAt: Date.now(),
    };

    this.patterns.set(entry.name, pattern);

    const event: PatternUpdateEvent = {
      type: existing ? 'updated' : 'added',
      pattern,
      timestamp: Date.now(),
    };

    this.emit('patternUpdate', event);

    this.recordVersionChange(
      version,
      event.type === 'added'
        ? `新增: ${entry.name}`
        : `更新: ${entry.name} (v${version})`
    );

    return entry.name;
  }

  /**
   * 移除模式
   * @param name 模式名称
   */
  removePattern(name: string): void {
    const existing = this.patterns.get(name);

    if (existing) {
      this.patterns.delete(name);

      this.emit('patternUpdate', {
        type: 'removed',
        pattern: existing,
        timestamp: Date.now(),
      } as PatternUpdateEvent);

      this.recordVersionChange(0, `移除: ${name}`);
    }
  }

  /**
   * 获取所有模式
   */
  getAllPatterns(): SecurityPatternEntry[] {
    return Array.from(this.patterns.values());
  }

  /**
   * 按类别获取模式
   * @param category 类别
   */
  getByCategory(category: string): SecurityPatternEntry[] {
    return this.getAllPatterns().filter((p) => p.category === category);
  }

  /**
   * 按风险级别获取模式
   * @param level 风险级别
   */
  getByRiskLevel(
    level: SecurityPatternEntry['riskLevel']
  ): SecurityPatternEntry[] {
    return this.getAllPatterns().filter((p) => p.riskLevel === level);
  }

  /**
   * 获取模式库统计
   */
  getStats(): {
    total: number;
    byCategory: Record<string, number>;
    byRiskLevel: Record<string, number>;
  } {
    const all = this.getAllPatterns();
    const byCategory: Record<string, number> = {};
    const byRiskLevel: Record<string, number> = {};

    for (const p of all) {
      byCategory[p.category] = (byCategory[p.category] || 0) + 1;
      byRiskLevel[p.riskLevel] = (byRiskLevel[p.riskLevel] || 0) + 1;
    }

    return { total: all.length, byCategory, byRiskLevel };
  }

  /**
   * 从 JSON 导入外部模式库
   * @param filePath JSON 文件路径
   */
  importFromJSON(filePath: string): number {
    if (!fs.existsSync(filePath)) return 0;

    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    if (!Array.isArray(data.patterns)) return 0;

    let count = 0;

    for (const entry of data.patterns) {
      if (entry.name && entry.pattern && entry.category) {
        this.addPattern({
          name: entry.name,
          pattern: entry.pattern,
          message: entry.message || '外部导入模式',
          riskLevel: entry.riskLevel || 'medium',
          behavior: entry.behavior || 'deny',
          category: entry.category,
        });
        count++;
      }
    }

    return count;
  }

  /**
   * 导出模式库为 JSON
   * @param filePath 文件路径
   */
  exportAsJSON(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data = {
      exportedAt: new Date().toISOString(),
      totalPatterns: this.patterns.size,
      patterns: this.getAllPatterns(),
    };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * 记录版本变更
   */
  private recordVersionChange(version: number, change: string): void {
    const entry = this.versionHistory[this.versionHistory.length - 1];

    if (entry) {
      entry.changes.push(change);
    } else {
      this.versionHistory.push({
        version,
        timestamp: Date.now(),
        changes: [change],
      });
    }

    if (this.versionHistory.length > this.config.maxVersionHistory) {
      this.versionHistory = this.versionHistory.slice(
        -this.config.maxVersionHistory
      );
    }
  }

  /**
   * 获取版本历史
   */
  getVersionHistory(): Array<{
    version: number;
    timestamp: number;
    changes: string[];
  }> {
    return [...this.versionHistory];
  }

  /**
   * 启动自动更新
   */
  startAutoUpdate(): void {
    if (this.updateTimer) return;

    this.updateTimer = setInterval(() => {
      const libPath = path.join(this.config.libraryDir, 'latest.json');

      if (fs.existsSync(libPath)) {
        const count = this.importFromJSON(libPath);
        if (count > 0) {
          this.emit('autoUpdate', { count, timestamp: Date.now() });
        }
      }
    }, this.config.autoUpdateIntervalMs);
  }

  /**
   * 停止自动更新
   */
  stopAutoUpdate(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  /**
   * 生成审计报告
   */
  generateAuditReport(): string {
    const stats = this.getStats();
    const history = this.getVersionHistory();
    const lines: string[] = [];

    lines.push('=== 安全模式库审计报告 ===');
    lines.push(`模式总数: ${stats.total}`);
    lines.push(
      `最后更新: ${history.length > 0 ? new Date(history[history.length - 1].timestamp).toISOString() : '无'}`
    );
    lines.push('');

    lines.push('按类别:');
    for (const [cat, count] of Object.entries(stats.byCategory)) {
      lines.push(`  ${cat}: ${count}`);
    }

    lines.push('');
    lines.push('按风险级别:');
    for (const [level, count] of Object.entries(stats.byRiskLevel)) {
      lines.push(`  ${level}: ${count}`);
    }

    return lines.join('\n');
  }

  /**
   * 清除所有自定义模式（保留内置）
   */
  clearCustom(): void {
    const builtinNames = new Set(BUILTIN_PATTERNS.map((p) => p.name));

    for (const name of this.patterns.keys()) {
      if (!builtinNames.has(name)) {
        this.patterns.delete(name);
      }
    }
  }
}

/**
 * 全局安全模式更新器
 */
let globalUpdater: SecurityPatternUpdater | null = null;

/**
 * 获取全局安全模式更新器
 */
export function getSecurityPatternUpdater(): SecurityPatternUpdater {
  if (!globalUpdater) {
    globalUpdater = new SecurityPatternUpdater();
  }

  return globalUpdater;
}
