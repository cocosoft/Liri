//
/**
 * 按键绑定配置的Zod schema
 * 用于验证和JSON schema生成
 */
import { z } from 'zod';
import type { KeybindingContextName } from './types.js';

/**
 * 有效的按键绑定上下文名称
 */
export const KEYBINDING_CONTEXTS = [
  'Global',
  'Chat',
  'Autocomplete',
  'Confirmation',
  'Help',
  'Transcript',
  'HistorySearch',
  'Task',
  'ThemePicker',
  'Settings',
  'Tabs',
  'Attachments',
  'Footer',
  'MessageSelector',
  'DiffDialog',
  'ModelPicker',
  'Select',
  'Plugin',
] as const;

/**
 * 每个按键绑定上下文的人类可读描述
 */
export const KEYBINDING_CONTEXT_DESCRIPTIONS: Record<
  (typeof KEYBINDING_CONTEXTS)[number],
  string
> = {
  Global: '全局有效，无论焦点在哪里',
  Chat: '当聊天输入框聚焦时',
  Autocomplete: '当自动完成菜单可见时',
  Confirmation: '当显示确认/权限对话框时',
  Help: '当帮助覆盖层打开时',
  Transcript: '当查看对话记录时',
  HistorySearch: '当搜索命令历史时（ctrl+r）',
  Task: '当任务/代理在前台运行时',
  ThemePicker: '当主题选择器打开时',
  Settings: '当设置菜单打开时',
  Tabs: '当标签导航激活时',
  Attachments: '当在选择对话框中导航图片附件时',
  Footer: '当页脚指示器聚焦时',
  MessageSelector: '当消息选择器（回退）打开时',
  DiffDialog: '当差异对话框打开时',
  ModelPicker: '当模型选择器打开时',
  Select: '当选择/列表组件聚焦时',
  Plugin: '当插件对话框打开时',
};

/**
 * 所有有效的按键绑定动作标识符
 */
export const KEYBINDING_ACTIONS = [
  // 应用级动作（全局上下文）
  'app:interrupt',
  'app:exit',
  'app:toggleTodos',
  'app:toggleTranscript',
  'app:toggleBrief',
  'app:toggleTeammatePreview',
  'app:toggleTerminal',
  'app:redraw',
  'app:globalSearch',
  'app:quickOpen',
  'app:undo',
  'app:copy',
  'app:clearLine',
  'app:clearScreen',
  'app:save',
  'app:copyAll',
  'app:clearAll',
  'app:reload',

  // 历史导航
  'history:search',
  'history:previous',
  'history:next',

  // 聊天输入动作
  'chat:cancel',
  'chat:killAgents',
  'chat:cycleMode',
  'chat:modelPicker',
  'chat:fastMode',
  'chat:thinkingToggle',
  'chat:submit',
  'chat:newline',
  'chat:undo',
  'chat:externalEditor',
  'chat:stash',
  'chat:imagePaste',
  'chat:messageActions',

  // 自动完成菜单动作
  'autocomplete:accept',
  'autocomplete:dismiss',
  'autocomplete:previous',
  'autocomplete:next',

  // 确认对话框动作
  'confirm:yes',
  'confirm:no',

  // 帮助覆盖层动作
  'help:close',

  // 对话记录动作
  'transcript:exit',
  'transcript:toggleShowAll',

  // 设置菜单动作
  'settings:close',
  'settings:search',

  // 选择/列表动作
  'select:accept',
  'select:cancel',
  'select:previous',
  'select:next',

  // 其他动作
  'task:background',
  'theme:toggleSyntaxHighlighting',
  'permission:accept',
  'permission:deny',
  'voice:pushToTalk',
] as const;

/**
 * 按键绑定上下文schema
 */
export const KeybindingContextSchema = z.enum(KEYBINDING_CONTEXTS);

/**
 * 按键绑定动作schema
 */
export const KeybindingActionSchema = z.enum(KEYBINDING_ACTIONS);

/**
 * 按键字符串schema（支持null值取消绑定）
 */
export const KeystrokeSchema = z.string().or(z.null());

/**
 * 按键绑定块schema
 */
export const KeybindingBlockSchema = z.object({
  context: KeybindingContextSchema,
  bindings: z.record(z.string(), KeystrokeSchema),
});

/**
 * 按键绑定配置schema
 */
export const KeybindingsSchema = z.object({
  $schema: z.string().optional(),
  $docs: z.string().optional(),
  bindings: z.array(KeybindingBlockSchema),
});

/**
 * 按键绑定配置类型
 */
export type KeybindingsSchemaType = z.infer<typeof KeybindingsSchema>;

/**
 * 按键绑定块类型
 */
export type KeybindingBlock = z.infer<typeof KeybindingBlockSchema>;

/**
 * 验证按键绑定配置
 */
export function validateKeybindings(config: unknown): {
  success: boolean;
  data?: KeybindingsSchemaType;
  errors?: z.ZodError[];
} {
  try {
    const result = KeybindingsSchema.safeParse(config);

    if (result.success) {
      return {
        success: true,
        data: result.data,
      };
    } else {
      return {
        success: false,
        errors: [result.error],
      };
    }
  } catch (error) {
    return {
      success: false,
      errors: [error as z.ZodError],
    };
  }
}

/**
 * 生成JSON schema用于编辑器验证
 */
export function generateJsonSchema(): object {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'PY_APP Keybindings Configuration',
    description: 'Configuration schema for PY_APP keyboard shortcuts',
    type: 'object',
    properties: {
      $schema: {
        type: 'string',
        description: 'Optional schema reference',
      },
      $docs: {
        type: 'string',
        description: 'Optional documentation reference',
      },
      bindings: {
        type: 'array',
        description: 'Array of keybinding blocks',
        items: {
          type: 'object',
          properties: {
            context: {
              type: 'string',
              enum: KEYBINDING_CONTEXTS,
              description: 'Context where the bindings apply',
            },
            bindings: {
              type: 'object',
              description: 'Mapping of keystrokes to actions',
              additionalProperties: {
                oneOf: [
                  { type: 'string', description: 'Action identifier' },
                  { type: 'null', description: 'Unbind the default' },
                ],
              },
            },
          },
          required: ['context', 'bindings'],
          additionalProperties: false,
        },
      },
    },
    required: ['bindings'],
    additionalProperties: false,
  };
}

/**
 * 获取上下文描述
 */
export function getContextDescription(context: KeybindingContextName): string {
  return KEYBINDING_CONTEXT_DESCRIPTIONS[context] || context;
}

/**
 * 获取所有上下文及其描述
 */
export function getAllContextsWithDescriptions(): Array<{
  context: KeybindingContextName;
  description: string;
}> {
  return KEYBINDING_CONTEXTS.map((context) => ({
    context,
    description: getContextDescription(context),
  }));
}

/**
 * 检查上下文是否有效
 */
export function isValidContext(
  context: string
): context is KeybindingContextName {
  return KEYBINDING_CONTEXTS.includes(context as KeybindingContextName);
}

/**
 * 检查动作是否有效
 */
export function isValidAction(
  action: string
): action is (typeof KEYBINDING_ACTIONS)[number] {
  return KEYBINDING_ACTIONS.includes(
    action as (typeof KEYBINDING_ACTIONS)[number]
  );
}

/**
 * 获取动作的默认上下文
 */
export function getDefaultContextForAction(
  action: string
): KeybindingContextName | undefined {
  const contextMap: Record<string, KeybindingContextName> = {
    // 应用级动作
    'app:interrupt': 'Global',
    'app:exit': 'Global',
    'app:toggleTodos': 'Global',
    'app:redraw': 'Global',
    'app:globalSearch': 'Global',
    'app:quickOpen': 'Global',

    // 聊天动作
    'chat:submit': 'Chat',
    'chat:newline': 'Chat',
    'chat:externalEditor': 'Chat',
    'chat:imagePaste': 'Chat',

    // 自动完成动作
    'autocomplete:accept': 'Autocomplete',
    'autocomplete:dismiss': 'Autocomplete',
    'autocomplete:previous': 'Autocomplete',
    'autocomplete:next': 'Autocomplete',

    // 确认动作
    'confirm:yes': 'Confirmation',
    'confirm:no': 'Confirmation',

    // 帮助动作
    'help:close': 'Help',

    // 对话记录动作
    'transcript:exit': 'Transcript',
    'transcript:toggleShowAll': 'Transcript',

    // 设置动作
    'settings:close': 'Settings',
    'settings:search': 'Settings',

    // 选择动作
    'select:accept': 'Select',
    'select:cancel': 'Select',
    'select:previous': 'Select',
    'select:next': 'Select',
  };

  return contextMap[action];
}

/**
 * 生成TypeScript类型定义
 */
export function generateTypeScriptDefinitions(): string {
  const contexts = KEYBINDING_CONTEXTS.map(
    (context) => `  | '${context}'`
  ).join('\n');
  const actions = KEYBINDING_ACTIONS.map((action) => `  | '${action}'`).join(
    '\n'
  );

  return `
/**
 * 按键绑定上下文名称
 */
export type KeybindingContextName =\n${contexts};

/**
 * 按键绑定动作标识符
 */
export type KeybindingAction =\n${actions};

/**
 * 按键绑定配置类型
 */
export interface KeybindingsConfig {
  $schema?: string;
  $docs?: string;
  bindings: Array<{
    context: KeybindingContextName;
    bindings: Record<string, string | null>;
  }>;
}
  `.trim();
}
