/**
 * 凭证池
 * 对标 Hermes agent/credential_pool.py
 * 实现 API Key 多凭证轮换和失败切换
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('ai:credentials:credentialPool');

/**
 * 凭证条目
 */
export interface Credential {
  /** 凭证 ID */
  id: string;
  /** API Key */
  apiKey: string;
  /** 凭证标签 */
  label: string;
  /** 优先级（更高更优先） */
  priority: number;
  /** 权重（轮换权重） */
  weight: number;
  /** 失败次数 */
  failures: number;
  /** 最大失败次数 */
  maxFailures: number;
  /** 是否禁用 */
  disabled: boolean;
  /** 最后使用时间 */
  lastUsedAt: number | null;
  /** 创建时间 */
  createdAt: number;
}

/**
 * CredentialSource — 凭证来源接口
 * 对标 OpenClaw-CredentialSource：允许从环境变量、配置文件、密钥管理器等来源获取凭证
 *
 * 实现者应返回来源已知的所有凭证列表
 */
export interface CredentialSource {
  /** 来源名称 */
  name: string;
  /** 获取该来源下所有凭证 */
  fetch(): Promise<Credential[]>;
  /** 来源优先级（小更优先），默认 10 */
  priority?: number;
}

/**
 * 凭证池配置
 */
export interface CredentialPoolConfig {
  /** 冷却时间（毫秒），失败后等待时间 */
  cooldownMs: number;
  /** 最大失败次数 */
  maxFailures: number;
  /** 是否为加权轮询 */
  weighted: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_POOL_CONFIG: CredentialPoolConfig = {
  cooldownMs: 30_000,
  maxFailures: 3,
  weighted: false,
};

/**
 * 凭证池
 */
export class CredentialPool {
  private credentials: Map<string, Credential> = new Map();
  private config: CredentialPoolConfig;

  /**
   * 构造函数
   * @param config 配置
   */
  constructor(config?: Partial<CredentialPoolConfig>) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
  }

  /**
   * 添加凭证
   * @param credential 凭证
   */
  addCredential(
    credential: Omit<
      Credential,
      'id' | 'disabled' | 'failures' | 'lastUsedAt' | 'createdAt'
    > & { id?: string }
  ): string {
    const id =
      credential.id ||
      `cred_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.credentials.set(id, {
      ...credential,
      id,
      disabled: false,
      failures: 0,
      maxFailures: credential.maxFailures || this.config.maxFailures,
      lastUsedAt: null,
      createdAt: Date.now(),
    });

    return id;
  }

  /**
   * 移除凭证
   * @param id 凭证 ID
   */
  removeCredential(id: string): void {
    this.credentials.delete(id);
  }

  /**
   * 获取下一个可用凭证（轮换策略）
   * @returns 凭证
   */
  next(): Credential | null {
    const available = this.getAvailableCredentials();

    if (available.length === 0) {
      return null;
    }

    if (this.config.weighted) {
      return this.weightedPick(available);
    }

    available.sort((a, b) => {
      if (!a.lastUsedAt) return -1;
      if (!b.lastUsedAt) return 1;

      return a.lastUsedAt - b.lastUsedAt;
    });

    const credential = available[0];
    credential.lastUsedAt = Date.now();

    return credential;
  }

  /**
   * 标记凭证失败
   * @param id 凭证 ID
   */
  markFailure(id: string): void {
    const credential = this.credentials.get(id);
    if (!credential) return;

    credential.failures++;

    if (credential.failures >= credential.maxFailures) {
      credential.disabled = true;
    }
  }

  /**
   * 标记凭证成功
   * @param id 凭证 ID
   */
  markSuccess(id: string): void {
    const credential = this.credentials.get(id);
    if (!credential) return;

    credential.failures = 0;
    credential.lastUsedAt = Date.now();
  }

  /**
   * 获取所有凭证
   * @returns 凭证列表
   */
  getAll(): Credential[] {
    return Array.from(this.credentials.values());
  }

  /**
   * 获取凭证数量
   */
  getCount(): { total: number; available: number; disabled: number } {
    const all = Array.from(this.credentials.values());

    return {
      total: all.length,
      available: all.filter((c) => !c.disabled).length,
      disabled: all.filter((c) => c.disabled).length,
    };
  }

  /**
   * 启用凭证
   * @param id 凭证 ID
   */
  enable(id: string): void {
    const credential = this.credentials.get(id);
    if (credential) {
      credential.disabled = false;
      credential.failures = 0;
    }
  }

  /**
   * 禁用凭证
   * @param id 凭证 ID
   */
  disable(id: string): void {
    const credential = this.credentials.get(id);
    if (credential) {
      credential.disabled = true;
    }
  }

  /**
   * 获取可用凭证列表
   */
  private getAvailableCredentials(): Credential[] {
    const now = Date.now();

    return Array.from(this.credentials.values()).filter(
      (c) =>
        !c.disabled &&
        (!c.lastUsedAt ||
          c.failures === 0 ||
          now - c.lastUsedAt > this.config.cooldownMs)
    );
  }

  /**
   * 加权选择
   * @param credentials 凭证列表
   * @returns 选中的凭证
   */
  private weightedPick(credentials: Credential[]): Credential {
    const totalWeight = credentials.reduce((sum, c) => sum + c.weight, 0);
    let random = Math.random() * totalWeight;

    for (const credential of credentials) {
      random -= credential.weight;
      if (random <= 0) {
        credential.lastUsedAt = Date.now();

        return credential;
      }
    }

    return credentials[0];
  }

  /**
   * 重置所有凭证的失败状态
   */
  resetAll(): void {
    for (const credential of this.credentials.values()) {
      credential.failures = 0;
      credential.disabled = false;
    }
  }

  /**
   * 获取凭证状态摘要
   */
  getStatus(
    id: string
  ): { available: boolean; failures: number; disabled: boolean } | null {
    const credential = this.credentials.get(id);
    if (!credential) return null;

    return {
      available: !credential.disabled,
      failures: credential.failures,
      disabled: credential.disabled,
    };
  }

  /**
   * 对 API Key 执行脱敏显示
   * 保留前6位和后4位，中间用星号代替
   *
   * @param apiKey 原始 API Key
   * @returns 脱敏后的字符串
   */
  static maskedKey(apiKey: string): string {
    if (!apiKey) return '';
    if (apiKey.length <= 10) {
      return apiKey.slice(0, 2) + '*'.repeat(apiKey.length - 2);
    }
    return (
      apiKey.slice(0, 6) + '*'.repeat(apiKey.length - 10) + apiKey.slice(-4)
    );
  }

  /**
   * 注册凭证来源
   * 来源会自动调用 fetch 并将凭证加入池中
   *
   * @param source 凭证来源
   */
  async registerSource(source: CredentialSource): Promise<void> {
    try {
      const credentials = await source.fetch();
      for (const cred of credentials) {
        this.addCredential(cred);
      }
      logger.info(
        `凭证来源 "${source.name}" 已注册，导入 ${credentials.length} 条凭证`
      );
    } catch (error) {
      await handleError(error, {
        module: 'ai:credential',
        action: `registerSource:${source.name}`,
      });
    }
  }
}
