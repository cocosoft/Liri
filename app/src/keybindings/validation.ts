/**
 * 按键绑定验证模块
 * 使用Zod进行数据验证
 */

import { z } from 'zod';

/**
 * 按键绑定模式类型
 */
export const KeybindingModeSchema = z.enum(['vi', 'emacs', 'default']);

/**
 * 动作类型
 */
export const ActionTypeSchema = z.enum([
  'command',
  'insert',
  'move',
  'edit',
  'navigate',
  'select',
  'file',
  'window',
  'view',
  'search',
  'clipboard',
  'undo',
  'mode',
]);

/**
 * 上下文类型
 */
export const ContextSchema = z.enum([
  'global',
  'editor',
  'terminal',
  'sidebar',
  'command-palette',
  'dialog',
  'settings',
  'file-explorer',
  'debugger',
  'output',
  'notification',
  'status-bar',
  'menu',
  'tooltip',
  'dropdown',
  'form',
  'modal',
]);

/**
 * 单个按键绑定
 */
export const KeybindingSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  modifier: z.array(z.string()).optional(),
  action: z.object({
    type: ActionTypeSchema,
    name: z.string().min(1),
    args: z.record(z.string(), z.any()).optional(),
  }),
  context: ContextSchema.default('global'),
  mode: KeybindingModeSchema.default('default'),
  description: z.string().optional(),
  enabled: z.boolean().default(true),
});

/**
 * 按键绑定集合
 */
export const KeybindingsSchema = z.array(KeybindingSchema);

/**
 * 按键绑定模板
 */
export const KeybindingTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  mode: KeybindingModeSchema,
  bindings: KeybindingsSchema,
});

/**
 * 按键绑定配置
 */
export const KeybindingConfigSchema = z.object({
  currentMode: KeybindingModeSchema,
  templates: z.array(KeybindingTemplateSchema),
  customBindings: KeybindingsSchema.default([]),
  disabledBindings: z.array(z.string()).default([]),
});

export type Keybinding = z.infer<typeof KeybindingSchema>;
export type Keybindings = z.infer<typeof KeybindingsSchema>;
export type KeybindingTemplate = z.infer<typeof KeybindingTemplateSchema>;
export type KeybindingConfig = z.infer<typeof KeybindingConfigSchema>;

/**
 * 验证单个按键绑定
 */
export function validateKeybinding(
  binding: unknown
): z.infer<typeof KeybindingSchema> {
  return KeybindingSchema.parse(binding);
}

/**
 * 验证按键绑定集合
 */
export function validateKeybindings(
  bindings: unknown
): z.infer<typeof KeybindingsSchema> {
  return KeybindingsSchema.parse(bindings);
}

/**
 * 验证按键绑定模板
 */
export function validateTemplate(
  template: unknown
): z.infer<typeof KeybindingTemplateSchema> {
  return KeybindingTemplateSchema.parse(template);
}

/**
 * 验证按键绑定配置
 */
export function validateConfig(
  config: unknown
): z.infer<typeof KeybindingConfigSchema> {
  return KeybindingConfigSchema.parse(config);
}

/**
 * 安全验证单个按键绑定（不抛出异常）
 */
export function safeValidateKeybinding(binding: unknown): {
  success: boolean;
  data?: z.infer<typeof KeybindingSchema>;
  error?: string;
} {
  const result = KeybindingSchema.safeParse(binding);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error.message };
}

/**
 * 安全验证按键绑定配置（不抛出异常）
 */
export function safeValidateConfig(config: unknown): {
  success: boolean;
  data?: z.infer<typeof KeybindingConfigSchema>;
  error?: string;
} {
  const result = KeybindingConfigSchema.safeParse(config);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error.message };
}
