/**
 * 按键绑定冲突检测模块
 * 用于检测和解决快捷键冲突
 */

import { KeybindingsSchemaType, KEYBINDING_CONTEXTS } from './schema';

export interface Conflict {
  keystroke: string;
  actions: string[];
  contexts: string[];
  severity: 'warning' | 'error';
  message: string;
}

export interface ConflictDetectionResult {
  conflicts: Conflict[];
  warnings: Conflict[];
  hasConflicts: boolean;
}

export interface ConflictResolution {
  keystroke: string;
  originalAction: string;
  newAction: string;
  resolved: boolean;
  resolution: 'keep-original' | 'replace' | 'rename-keystroke';
}

export class ConflictDetector {
  private config: KeybindingsSchemaType;

  constructor(config: KeybindingsSchemaType) {
    this.config = config;
  }

  /**
   * 检测所有冲突
   */
  detect(): ConflictDetectionResult {
    const conflicts: Conflict[] = [];
    const warnings: Conflict[] = [];

    // 创建按键到动作的映射
    const keystrokeMap = new Map<
      string,
      Array<{ action: string; context: string }>
    >();

    for (const block of this.config.bindings) {
      for (const [keystroke, action] of Object.entries(block.bindings)) {
        if (action === null) continue;

        if (!keystrokeMap.has(keystroke)) {
          keystrokeMap.set(keystroke, []);
        }
        keystrokeMap.get(keystroke)!.push({ action, context: block.context });
      }
    }

    // 检查冲突
    for (const [keystroke, entries] of keystrokeMap) {
      if (entries.length > 1) {
        const contexts = entries.map((e) => e.context);
        const actions = entries.map((e) => e.action);

        // 检查是否在相同上下文
        const hasSameContext = this.hasDuplicateContexts(contexts);

        if (hasSameContext) {
          conflicts.push({
            keystroke,
            actions,
            contexts,
            severity: 'error',
            message: `按键 "${keystroke}" 在相同上下文 "${contexts.join(', ')}" 中绑定到多个动作: ${actions.join(', ')}`,
          });
        } else {
          warnings.push({
            keystroke,
            actions,
            contexts,
            severity: 'warning',
            message: `按键 "${keystroke}" 在不同上下文绑定到不同动作: ${actions.join(', ')} (上下文: ${contexts.join(', ')})`,
          });
        }
      }
    }

    return {
      conflicts,
      warnings,
      hasConflicts: conflicts.length > 0,
    };
  }

  /**
   * 检查是否有重复上下文
   */
  private hasDuplicateContexts(contexts: string[]): boolean {
    const seen = new Set<string>();
    for (const ctx of contexts) {
      if (seen.has(ctx)) {
        return true;
      }
      seen.add(ctx);
    }
    return false;
  }

  /**
   * 获取冲突详情
   */
  getConflictDetails(keystroke: string): Conflict | undefined {
    const result = this.detect();
    return result.conflicts.find((c) => c.keystroke === keystroke);
  }

  /**
   * 自动解决冲突
   */
  autoResolve(): ConflictResolution[] {
    const result = this.detect();
    const resolutions: ConflictResolution[] = [];

    for (const conflict of result.conflicts) {
      // 默认保留第一个绑定
      const firstAction = conflict.actions[0];
      const otherActions = conflict.actions.slice(1);

      for (const action of otherActions) {
        resolutions.push({
          keystroke: conflict.keystroke,
          originalAction: firstAction,
          newAction: action,
          resolved: true,
          resolution: 'keep-original',
        });
      }
    }

    return resolutions;
  }

  /**
   * 解决特定冲突
   */
  resolveConflict(
    keystroke: string,
    resolution: 'keep-original' | 'replace' | 'rename-keystroke',
    newKeystroke?: string
  ): ConflictResolution | null {
    const result = this.detect();
    const conflict = result.conflicts.find((c) => c.keystroke === keystroke);

    if (!conflict) return null;

    if (resolution === 'keep-original') {
      // 保留第一个动作，移除其他动作
      const firstAction = conflict.actions[0];
      for (let i = 0; i < this.config.bindings.length; i++) {
        const block = this.config.bindings[i];
        if (
          block.bindings[keystroke] &&
          block.bindings[keystroke] !== firstAction
        ) {
          block.bindings[keystroke] = null;
        }
      }

      return {
        keystroke,
        originalAction: firstAction,
        newAction: conflict.actions[1] || '',
        resolved: true,
        resolution: 'keep-original',
      };
    }

    if (resolution === 'replace') {
      // 用最后一个动作替换所有其他动作
      const lastAction = conflict.actions[conflict.actions.length - 1];
      for (const block of this.config.bindings) {
        if (block.bindings[keystroke]) {
          block.bindings[keystroke] = lastAction;
        }
      }

      return {
        keystroke,
        originalAction: conflict.actions[0],
        newAction: lastAction,
        resolved: true,
        resolution: 'replace',
      };
    }

    if (resolution === 'rename-keystroke' && newKeystroke) {
      // 将第一个动作保留在原按键，其他动作移到新按键
      const firstAction = conflict.actions[0];
      const firstContext = conflict.contexts[0];

      for (let i = 0; i < this.config.bindings.length; i++) {
        const block = this.config.bindings[i];
        if (
          block.bindings[keystroke] &&
          block.bindings[keystroke] !== firstAction
        ) {
          block.bindings[newKeystroke] = block.bindings[keystroke];
          block.bindings[keystroke] = null;
        }
      }

      return {
        keystroke,
        originalAction: firstAction,
        newAction: newKeystroke,
        resolved: true,
        resolution: 'rename-keystroke',
      };
    }

    return null;
  }

  /**
   * 检查特定按键是否有冲突
   */
  hasConflict(keystroke: string): boolean {
    const result = this.detect();
    return result.conflicts.some((c) => c.keystroke === keystroke);
  }

  /**
   * 获取所有冲突按键列表
   */
  getConflictingKeystrokes(): string[] {
    const result = this.detect();
    return result.conflicts.map((c) => c.keystroke);
  }

  /**
   * 生成冲突报告
   */
  generateReport(): string {
    const result = this.detect();
    let report = `按键绑定冲突检测报告\n`;
    report += `=========================\n\n`;

    if (result.conflicts.length > 0) {
      report += `❌ 发现 ${result.conflicts.length} 个错误冲突:\n`;
      for (const conflict of result.conflicts) {
        report += `  - ${conflict.message}\n`;
      }
    } else {
      report += `✅ 未发现错误冲突\n`;
    }

    if (result.warnings.length > 0) {
      report += `\n⚠️ 发现 ${result.warnings.length} 个警告:\n`;
      for (const warning of result.warnings) {
        report += `  - ${warning.message}\n`;
      }
    }

    return report;
  }
}

/**
 * 创建冲突检测器
 */
export function createConflictDetector(
  config: KeybindingsSchemaType
): ConflictDetector {
  return new ConflictDetector(config);
}

/**
 * 验证按键绑定配置是否有冲突
 */
export function validateKeybindingsForConflicts(
  config: KeybindingsSchemaType
): ConflictDetectionResult {
  const detector = new ConflictDetector(config);
  return detector.detect();
}

/**
 * 检查单个按键绑定是否会导致冲突
 */
export function checkBindingConflict(
  config: KeybindingsSchemaType,
  context: string,
  keystroke: string,
  action: string
): Conflict | undefined {
  const detector = new ConflictDetector(config);
  const result = detector.detect();

  return result.conflicts.find(
    (c) =>
      c.keystroke === keystroke &&
      c.contexts.includes(context) &&
      c.actions.includes(action)
  );
}

export type ConflictResult = ConflictDetectionResult;
