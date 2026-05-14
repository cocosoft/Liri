/**
 * 凭证来源
 * 对标 Hermes 凭证发现机制
 * 从多个来源发现和加载 API 凭证
 */

/**
 * 凭证来源类型
 */
export type CredentialSourceType =
  | 'env'
  | 'file'
  | 'config'
  | 'vault'
  | 'service';

/**
 * 凭证来源条目
 */
export interface CredentialSourceEntry {
  key: string;
  value: string;
  label: string;
  source: CredentialSourceType;
  discoveredAt: number;
}

/**
 * 凭证来源配置
 */
export interface CredentialSourceConfig {
  envPrefixes: string[];
  envSuffixes: string[];
  allowedKeys: string[];
  filePaths: string[];
}

/**
 * 默认配置
 */
const DEFAULT_SOURCE_CONFIG: CredentialSourceConfig = {
  envPrefixes: [
    'ANTHROPIC_',
    'OPENAI_',
    'GOOGLE_',
    'DEEPSEEK_',
    'GROK_',
    'MOONSHOT_',
    'AZURE_',
  ],
  envSuffixes: ['_API_KEY', '_API_TOKEN', '_KEY', '_SECRET'],
  allowedKeys: [],
  filePaths: [],
};

/**
 * 凭证来源
 */
export class CredentialSource {
  private config: CredentialSourceConfig;

  /**
   * 构造函数
   * @param config 配置
   */
  constructor(config?: Partial<CredentialSourceConfig>) {
    this.config = { ...DEFAULT_SOURCE_CONFIG, ...config };
  }

  /**
   * 从环境变量发现凭证
   * @returns 凭证条目列表
   */
  discoverFromEnv(): CredentialSourceEntry[] {
    const entries: CredentialSourceEntry[] = [];
    const now = Date.now();

    for (const [key, value] of Object.entries(process.env)) {
      if (!value || value.length < 10) continue;

      const isMatch = this.matchesEnvPattern(key);

      if (isMatch) {
        entries.push({
          key,
          value,
          label: `环境变量: ${key}`,
          source: 'env',
          discoveredAt: now,
        });
      }
    }

    return entries;
  }

  /**
   * 从配置文件发现凭证
   * @param configObj 配置对象
   * @returns 凭证条目列表
   */
  discoverFromConfig(
    configObj: Record<string, unknown>
  ): CredentialSourceEntry[] {
    const entries: CredentialSourceEntry[] = [];
    const now = Date.now();

    for (const [key, value] of Object.entries(configObj)) {
      if (typeof value !== 'string' || value.length < 10) continue;

      if (this.matchesEnvPattern(key)) {
        entries.push({
          key,
          value,
          label: `配置: ${key}`,
          source: 'config',
          discoveredAt: now,
        });
      }
    }

    return entries;
  }

  /**
   * 从环境变量文件发现凭证
   * @param content .env 文件内容
   * @returns 凭证条目列表
   */
  discoverFromEnvFileContent(content: string): CredentialSourceEntry[] {
    const entries: CredentialSourceEntry[] = [];
    const now = Date.now();
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex < 0) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (value.length < 10) continue;

      if (this.matchesEnvPattern(key)) {
        entries.push({
          key,
          value,
          label: `文件: ${key}`,
          source: 'file',
          discoveredAt: now,
        });
      }
    }

    return entries;
  }

  /**
   * 检查密钥是否匹配环境变量模式
   * @param key 密钥名
   */
  private matchesEnvPattern(key: string): boolean {
    const upperKey = key.toUpperCase();

    for (const prefix of this.config.envPrefixes) {
      if (upperKey.startsWith(prefix.toUpperCase())) {
        return true;
      }
    }

    for (const suffix of this.config.envSuffixes) {
      if (upperKey.endsWith(suffix.toUpperCase())) {
        return true;
      }
    }

    if (this.config.allowedKeys.length > 0) {
      return this.config.allowedKeys.some(
        (allowed) => upperKey === allowed.toUpperCase()
      );
    }

    return false;
  }

  /**
   * 发现所有凭证
   * @param configObj 配置对象（可选）
   * @returns 凭证条目列表
   */
  discoverAll(configObj?: Record<string, unknown>): CredentialSourceEntry[] {
    const entries = this.discoverFromEnv();

    if (configObj) {
      const configEntries = this.discoverFromConfig(configObj);
      entries.push(...configEntries);
    }

    const seen = new Set<string>();
    return entries.filter((e) => {
      const dedupKey = `${e.source}:${e.key}`;
      if (seen.has(dedupKey)) return false;
      seen.add(dedupKey);

      return true;
    });
  }

  /**
   * 获取凭证来源统计
   * @param entries 凭证条目
   */
  getSourceSummary(entries: CredentialSourceEntry[]): Record<string, number> {
    const summary: Record<string, number> = {};

    for (const entry of entries) {
      summary[entry.source] = (summary[entry.source] || 0) + 1;
    }

    return summary;
  }
}
