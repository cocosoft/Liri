/**
 * WizardEngine 向导系统引擎
 * 对标 OpenClaw 的 wizard 系统，提供交互式配置引导
 */
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';

/**
 * 向导步骤类型
 */
export type WizardStepType =
  | 'input'
  | 'confirm'
  | 'select'
  | 'multiselect'
  | 'password'
  | 'info';

/**
 * 向导步骤
 */
export interface WizardStep {
  id: string;
  type: WizardStepType;
  title: string;
  description?: string;
  prompt: string;
  options?: string[];
  default?: unknown;
  validator?: (value: string) => string | null;
  condition?: (answers: Record<string, unknown>) => boolean;
}

/**
 * 向导定义
 */
export interface Wizard {
  id: string;
  name: string;
  description: string;
  steps: WizardStep[];
  onComplete?: (answers: Record<string, unknown>) => Promise<void> | void;
  onCancel?: () => void;
}

/**
 * 向导状态
 */
export interface WizardState {
  wizardId: string;
  currentStep: number;
  answers: Record<string, unknown>;
  startedAt: number;
  completed: boolean;
  cancelled: boolean;
}

/**
 * 向导事件
 */
export interface WizardEvent {
  type:
    | 'wizard:start'
    | 'wizard:step'
    | 'wizard:complete'
    | 'wizard:cancel'
    | 'wizard:error';
  wizardId: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

/**
 * 向导引擎
 */
export class WizardEngine extends EventEmitter {
  private wizards: Map<string, Wizard> = new Map();
  private activeStates: Map<string, WizardState> = new Map();
  private rl: readline.Interface | null = null;

  /**
   * 注册向导
   */
  register(wizard: Wizard): boolean {
    if (this.wizards.has(wizard.id)) {
      return false;
    }

    this.wizards.set(wizard.id, wizard);

    return true;
  }

  /**
   * 获取向导
   */
  get(wizardId: string): Wizard | undefined {
    return this.wizards.get(wizardId);
  }

  /**
   * 获取所有向导
   */
  getAll(): Wizard[] {
    return Array.from(this.wizards.values());
  }

  /**
   * 注销向导
   */
  unregister(wizardId: string): boolean {
    return this.wizards.delete(wizardId);
  }

  /**
   * 启动向导（交互模式）
   */
  async start(
    wizardId: string,
    initialAnswers: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    const wizard = this.wizards.get(wizardId);

    if (!wizard) {
      throw new AppError(
        `向导 "${wizardId}" 未找到`,
        ErrorCategory.RESOURCE,
        ErrorSeverity.HIGH,
        'ENTITY_NOT_FOUND',
        { wizardId }
      );
    }

    const state: WizardState = {
      wizardId,
      currentStep: 0,
      answers: { ...initialAnswers },
      startedAt: Date.now(),
      completed: false,
      cancelled: false,
    };

    this.activeStates.set(wizardId, state);

    const startEvent: WizardEvent = {
      type: 'wizard:start',
      wizardId,
      timestamp: Date.now(),
    };

    this.emit('wizard:start', startEvent);

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      for (let i = 0; i < wizard.steps.length; i++) {
        const step = wizard.steps[i];

        if (step.condition && !step.condition(state.answers)) {
          continue;
        }

        state.currentStep = i;

        const stepEvent: WizardEvent = {
          type: 'wizard:step',
          wizardId,
          timestamp: Date.now(),
          data: { stepId: step.id, stepIndex: i },
        };

        this.emit('wizard:step', stepEvent);

        const answer = await this.askStep(step, state.answers);

        if (answer === null) {
          state.cancelled = true;

          if (wizard.onCancel) {
            wizard.onCancel();
          }

          const cancelEvent: WizardEvent = {
            type: 'wizard:cancel',
            wizardId,
            timestamp: Date.now(),
          };

          this.emit('wizard:cancel', cancelEvent);

          return state.answers;
        }

        state.answers[step.id] = answer;
      }

      state.completed = true;

      if (wizard.onComplete) {
        await wizard.onComplete(state.answers);
      }

      const completeEvent: WizardEvent = {
        type: 'wizard:complete',
        wizardId,
        timestamp: Date.now(),
        data: { answers: state.answers },
      };

      this.emit('wizard:complete', completeEvent);

      return state.answers;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      const errorEvent: WizardEvent = {
        type: 'wizard:error',
        wizardId,
        timestamp: Date.now(),
        data: { error: message },
      };

      this.emit('wizard:error', errorEvent);

      throw error;
    } finally {
      if (this.rl) {
        this.rl.close();
        this.rl = null;
      }

      this.activeStates.delete(wizardId);
    }
  }

  /**
   * 执行向导步骤（编程模式，无需交互）
   */
  async execute(
    wizardId: string,
    answers: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const wizard = this.wizards.get(wizardId);

    if (!wizard) {
      throw new AppError(
        `向导 "${wizardId}" 未找到`,
        ErrorCategory.RESOURCE,
        ErrorSeverity.HIGH,
        'ENTITY_NOT_FOUND',
        { wizardId }
      );
    }

    const state: WizardState = {
      wizardId,
      currentStep: 0,
      answers: { ...answers },
      startedAt: Date.now(),
      completed: false,
      cancelled: false,
    };

    for (let i = 0; i < wizard.steps.length; i++) {
      const step = wizard.steps[i];

      if (step.condition && !step.condition(state.answers)) {
        continue;
      }

      if (step.validator && typeof state.answers[step.id] === 'string') {
        const validationError = step.validator(
          state.answers[step.id] as string
        );

        if (validationError) {
          throw new AppError(
            `步骤 "${step.id}" 验证失败: ${validationError}`,
            ErrorCategory.VALIDATION,
            ErrorSeverity.HIGH,
            'INVALID_INPUT',
            { stepId: step.id, validationError }
          );
        }
      }
    }

    state.completed = true;

    if (wizard.onComplete) {
      await wizard.onComplete(state.answers);
    }

    return state.answers;
  }

  /**
   * 询问一个步骤
   */
  private askStep(
    step: WizardStep,
    _answers: Record<string, unknown>
  ): Promise<unknown> {
    return new Promise((resolve) => {
      if (!this.rl) {
        resolve(null);

        return;
      }

      process.stdout.write(`\n=== ${step.title} ===\n`);

      if (step.description) {
        process.stdout.write(step.description + '\n');
      }

      switch (step.type) {
        case 'info':
          process.stdout.write(step.prompt + '\n');
          resolve(true);

          break;

        case 'confirm': {
          const defaultStr =
            step.default !== undefined ? (step.default ? 'Y/n' : 'y/N') : 'y/n';

          this.rl!.question(
            `${step.prompt} (${defaultStr}): `,
            (input: string) => {
              const trimmed = input.trim().toLowerCase();

              if (trimmed === '') {
                resolve(step.default ?? true);
              } else {
                resolve(trimmed === 'y' || trimmed === 'yes');
              }
            }
          );

          break;
        }

        case 'select':
          if (step.options) {
            process.stdout.write('可选选项:\n');

            step.options.forEach((opt, idx) => {
              process.stdout.write(`  ${idx + 1}. ${opt}\n`);
            });
          }

          this.rl!.question(`${step.prompt}: `, (input: string) => {
            const trimmed = input.trim();
            const index = parseInt(trimmed, 10) - 1;

            if (step.options && index >= 0 && index < step.options.length) {
              resolve(step.options[index]);
            } else if (step.options && step.options.includes(trimmed)) {
              resolve(trimmed);
            } else {
              resolve(
                step.default || (step.options ? step.options[0] : trimmed)
              );
            }
          });

          break;

        case 'multiselect':
          if (step.options) {
            process.stdout.write('可选选项 (逗号分隔):\n');

            step.options.forEach((opt, idx) => {
              process.stdout.write(`  ${idx + 1}. ${opt}\n`);
            });
          }

          this.rl!.question(`${step.prompt}: `, (input: string) => {
            const trimmed = input.trim();

            if (!trimmed) {
              resolve(step.default || []);
            } else {
              const selected = trimmed
                .split(',')
                .map((s) => {
                  const idx = parseInt(s.trim(), 10) - 1;

                  if (step.options && idx >= 0 && idx < step.options.length) {
                    return step.options[idx];
                  }

                  return s.trim();
                })
                .filter(Boolean);

              resolve(selected);
            }
          });

          break;

        case 'password':
          this.rl!.question(`${step.prompt}: `, (input: string) => {
            const trimmed = input.trim();

            if (step.validator) {
              const error = step.validator(trimmed);

              if (error) {
                process.stdout.write(`验证失败: ${error}\n`);
                resolve(this.askStep(step, _answers));
              } else {
                resolve(trimmed || step.default || '');
              }
            } else {
              resolve(trimmed || step.default || '');
            }
          });

          break;

        case 'input':
        default:
          this.rl!.question(`${step.prompt}: `, (input: string) => {
            const trimmed = input.trim();

            if (step.validator) {
              const error = step.validator(trimmed);

              if (error) {
                process.stdout.write(`验证失败: ${error}\n`);
                resolve(this.askStep(step, _answers));
              } else {
                resolve(trimmed || step.default || '');
              }
            } else {
              resolve(trimmed || step.default || '');
            }
          });

          break;
      }
    });
  }

  /**
   * 注册配置向导
   */
  registerConfigWizard(): void {
    this.register({
      id: 'config-wizard',
      name: '配置向导',
      description: '引导式配置 Liri 应用',
      steps: [
        {
          id: 'welcome',
          type: 'info',
          title: '欢迎使用 Liri 配置向导',
          description: '本向导将引导您完成 Liri 的基本配置。',
          prompt: '按回车继续...',
        },
        {
          id: 'api_key',
          type: 'input',
          title: 'API 密钥',
          description: '请输入您的 AI 服务 API 密钥',
          prompt: 'API Key',
          validator: (value: string) =>
            value.length < 8 ? 'API 密钥长度至少 8 位' : null,
        },
        {
          id: 'model',
          type: 'select',
          title: '默认模型',
          description: '选择默认使用的 AI 模型',
          prompt: '请选择模型',
          options: [
            'claude-sonnet-4',
            'gpt-4o',
            'deepseek-v3',
            'gemini-2.0-pro',
          ],
          default: 'claude-sonnet-4',
        },
        {
          id: 'daemon',
          type: 'confirm',
          title: '守护进程',
          description: '是否启用后台守护进程？',
          prompt: '启用守护进程',
          default: true,
        },
        {
          id: 'theme',
          type: 'select',
          title: '主题设置',
          description: '选择终端主题',
          prompt: '请选择主题',
          options: ['dark', 'light', 'auto'],
          default: 'dark',
        },
      ],
      onComplete: async (answers: Record<string, unknown>) => {
        process.stdout.write('\n配置完成！\n');
        process.stdout.write(`  模型: ${answers.model}\n`);
        process.stdout.write(
          `  守护进程: ${answers.daemon ? '启用' : '禁用'}\n`
        );
        process.stdout.write(`  主题: ${answers.theme}\n`);
      },
    });
  }

  /**
   * 注册通道配置向导
   */
  registerChannelWizard(): void {
    this.register({
      id: 'channel-wizard',
      name: '通道配置向导',
      description: '引导式配置消息通道',
      steps: [
        {
          id: 'channel_type',
          type: 'select',
          title: '通道类型',
          description: '选择要配置的消息通道类型',
          prompt: '请选择通道类型',
          options: ['telegram', 'discord', 'slack', 'irc', 'line'],
        },
        {
          id: 'channel_token',
          type: 'password',
          title: '通道 Token',
          description: '请输入通道的认证 Token',
          prompt: 'Token',
          validator: (value: string) => (!value ? 'Token 不能为空' : null),
        },
        {
          id: 'auto_connect',
          type: 'confirm',
          title: '自动连接',
          description: '是否在启动时自动连接？',
          prompt: '自动连接',
          default: true,
        },
      ],
    });
  }

  /**
   * 获取活跃的向导状态
   */
  getActiveState(wizardId: string): WizardState | undefined {
    return this.activeStates.get(wizardId);
  }

  /**
   * 获取统计
   */
  getStats(): { total: number; active: number } {
    return {
      total: this.wizards.size,
      active: this.activeStates.size,
    };
  }
}

export const wizardEngine = new WizardEngine();
