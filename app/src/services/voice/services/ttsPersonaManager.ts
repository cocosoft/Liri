/**
 * TTSPersonaManager
 * TTS 人设管理系统
 *
 * 人设（Persona）是语音合成的一套完整配置组合，包含：
 *   - 使用的 TTS 提供者
 *   - 语音 ID
 *   - 语速
 *   - 语言
 *
 * 人设支持 CRUD 操作，并可绑定到 Agent，通过 TTSConfigOverlay 生效。
 *
 * 方案 20：支持多工作区 TTS 上下文隔离。
 * 每个工作区绑定独立的 TTS 上下文（currentPersonaId、volume、rate），
 * 工作区切换时自动加载对应上下文，工作区销毁时自动清理。
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getDefaultConfigOverlay } from './ttsConfigOverlay';

const logger = new Logger({ level: LogLevel.INFO });

/** TTS 上下文（方案 20：多工作区隔离） */
export interface TTSContext {
  currentPersonaId: string | null;
  volume: number;
  rate: number;
}

/** TTS 人设 */
export interface TTSPersona {
  /** 人设唯一标识 */
  id: string;
  /** 人设名称 */
  name: string;
  /** 人设描述 */
  description?: string;
  /** 使用的 TTS 提供者名称 */
  provider: string;
  /** 语音 ID */
  voice: string;
  /** 语速（1.0 为正常） */
  speed: number;
  /** 语言代码 */
  language: string;
}

/**
 * 创建人设的选项（不含 id，由系统自动生成）
 */
export type CreatePersonaOptions = Omit<TTSPersona, 'id'>;

/** Agent 与人设的绑定关系 */
interface PersonaBinding {
  agentId: string;
  personaId: string;
}

/**
 * TTS 人设管理器
 */
export class TTSPersonaManager {
  /** 人设存储 */
  private static personas: Map<string, TTSPersona> = new Map();

  /** Agent → 人设绑定关系 */
  private static bindings: Map<string, string> = new Map();

  /** ID 计数器 */
  private static nextId: number = 1;

  /**
   * 列出所有人设
   */
  static list(): TTSPersona[] {
    return Array.from(TTSPersonaManager.personas.values());
  }

  /**
   * 获取单个人设
   */
  static get(id: string): TTSPersona | undefined {
    return TTSPersonaManager.personas.get(id);
  }

  /**
   * 创建新的人设
   *
   * @returns 创建完成的人设（含自动生成的 id）
   */
  static create(options: CreatePersonaOptions): TTSPersona {
    const id = `persona_${TTSPersonaManager.nextId++}`;

    const persona: TTSPersona = {
      id,
      name: options.name,
      description: options.description,
      provider: options.provider,
      voice: options.voice,
      speed: options.speed,
      language: options.language,
    };

    TTSPersonaManager.personas.set(id, persona);

    logger.info('TTSPersonaManager · 创建人设', {
      id,
      name: options.name,
      provider: options.provider,
    });

    return { ...persona };
  }

  /**
   * 更新现有的人设
   *
   * @param id 人设 ID
   * @param partial 要更新的字段
   * @returns 是否更新成功（false 表示人设不存在）
   */
  static update(id: string, partial: Partial<CreatePersonaOptions>): boolean {
    const existing = TTSPersonaManager.personas.get(id);
    if (!existing) {
      logger.warn('TTSPersonaManager · 更新人设失败：不存在', { id });
      return false;
    }

    const updated: TTSPersona = {
      ...existing,
      ...partial,
      id, // 防止 id 被覆盖
    };

    TTSPersonaManager.personas.set(id, updated);

    logger.info('TTSPersonaManager · 更新人设', { id, name: updated.name });

    return true;
  }

  /**
   * 删除人设
   *
   * 同时会清理该人设的所有 Agent 绑定关系。
   *
   * @returns 是否删除成功（false 表示人设不存在）
   */
  static delete(id: string): boolean {
    const existed = TTSPersonaManager.personas.has(id);
    if (!existed) {
      logger.warn('TTSPersonaManager · 删除人设失败：不存在', { id });
      return false;
    }

    TTSPersonaManager.personas.delete(id);

    // 清理与该人设相关的所有绑定
    for (const [agentId, personaId] of TTSPersonaManager.bindings) {
      if (personaId === id) {
        TTSPersonaManager.bindings.delete(agentId);
      }
    }

    logger.info('TTSPersonaManager · 删除人设', { id });

    return true;
  }

  /**
   * 将人设绑定到 Agent
   *
   * 绑定后可通过 TTSConfigOverlay 应用该人设的配置。
   * 同一 Agent 只能绑定一个人设，新绑定会覆盖旧绑定。
   */
  static bindToAgent(agentId: string, personaId: string): boolean {
    const persona = TTSPersonaManager.personas.get(personaId);
    if (!persona) {
      logger.warn('TTSPersonaManager · 绑定 Agent 失败：人设不存在', {
        agentId,
        personaId,
      });
      return false;
    }

    TTSPersonaManager.bindings.set(agentId, personaId);

    logger.info('TTSPersonaManager · 绑定 Agent', {
      agentId,
      personaId,
      personaName: persona.name,
    });

    return true;
  }

  /**
   * 解除 Agent 的人设绑定
   */
  static unbindFromAgent(agentId: string): void {
    TTSPersonaManager.bindings.delete(agentId);
    logger.info('TTSPersonaManager · 解除 Agent 绑定', { agentId });
  }

  /**
   * 获取 Agent 绑定的人设
   */
  static getPersonaForAgent(agentId: string): TTSPersona | undefined {
    const personaId = TTSPersonaManager.bindings.get(agentId);
    if (!personaId) {
      return undefined;
    }

    return TTSPersonaManager.personas.get(personaId);
  }

  /**
   * 获取 Agent 绑定的人设 ID
   */
  static getPersonaIdForAgent(agentId: string): string | undefined {
    return TTSPersonaManager.bindings.get(agentId);
  }

  /**
   * 获取所有人设绑定关系
   */
  static listBindings(): Array<{ agentId: string; personaId: string }> {
    return Array.from(TTSPersonaManager.bindings.entries()).map(
      ([agentId, personaId]) => ({ agentId, personaId })
    );
  }

  /**
   * 应用人设配置到 TTSConfigOverlay
   *
   * 将 Agent 所绑定的人设配置写入全局 TTSConfigOverlay 的提供者默认配置中，
   * 使其在后续 TTS 调用中自动生效。
   *
   * @param agentId Agent ID
   * @returns 是否成功应用（false 表示 Agent 未绑定人设）
   */
  static applyPersonaToOverlay(agentId: string): boolean {
    const persona = TTSPersonaManager.getPersonaForAgent(agentId);
    if (!persona) {
      logger.warn('TTSPersonaManager · 应用人设失败：Agent 未绑定', {
        agentId,
      });
      return false;
    }

    try {
      const overlay = getDefaultConfigOverlay();

      overlay.setProviderDefaults(persona.provider, {
        voice: persona.voice,
        speed: persona.speed,
        language: persona.language,
      });

      logger.info('TTSPersonaManager · 应用人设到配置覆盖', {
        agentId,
        personaId: persona.id,
        provider: persona.provider,
      });

      return true;
    } catch (error) {
      void handleError(error, {
        module: 'services:voice:ttsPersonaManager',
        action: 'applyPersonaToOverlay',
        context: { agentId, personaId: persona.id },
      });
      return false;
    }
  }

  /**
   * 清空所有人设和绑定关系（主要用于测试）
   */
  static reset(): void {
    const count = TTSPersonaManager.personas.size;
    const bindCount = TTSPersonaManager.bindings.size;
    TTSPersonaManager.personas.clear();
    TTSPersonaManager.bindings.clear();
    TTSPersonaManager.nextId = 1;
    logger.info('TTSPersonaManager · 重置', {
      personaCount: count,
      bindingCount: bindCount,
    });
  }

  // ===========================================================
  // 多工作区 TTS 上下文隔离（方案 20）
  // ===========================================================

  /** 工作区 → TTS 上下文映射 */
  private static personaContexts = new Map<string, TTSContext>();

  /**
   * getContext — 获取指定工作区的 TTS 上下文（方案 20）
   *
   * 如果该工作区尚无上下文，自动创建默认上下文。
   *
   * @param workspaceId 工作区 ID
   * @returns 该工作区的 TTS 上下文
   */
  static getContext(workspaceId: string): TTSContext {
    let context = TTSPersonaManager.personaContexts.get(workspaceId);
    if (!context) {
      context = {
        currentPersonaId: null,
        volume: 1.0,
        rate: 1.0,
      };
      TTSPersonaManager.personaContexts.set(workspaceId, context);
    }
    return context;
  }

  /**
   * removeContext — 销毁工作区时清理 TTS 上下文（方案 20）
   *
   * @param workspaceId 工作区 ID
   */
  static removeContext(workspaceId: string): void {
    TTSPersonaManager.personaContexts.delete(workspaceId);
    logger.debug('TTSPersonaManager · 移除 TTS 上下文', { workspaceId });
  }

  /**
   * setContext — 设置指定工作区的 TTS 上下文（方案 20）
   *
   * @param workspaceId 工作区 ID
   * @param context TTS 上下文
   */
  static setContext(workspaceId: string, context: TTSContext): void {
    TTSPersonaManager.personaContexts.set(workspaceId, context);
  }
}
