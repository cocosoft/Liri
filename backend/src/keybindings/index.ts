/**
 * Keybindings模块导出文件
 */

export * from './actions';
export * from './keybindings';
export * from './keymap';
export * from './schema';
export * from './template';
export * from './conflictDetector';
export * from './keybindingManager';
export * from './validation';
export * from './templates';
export * from './templateManager';

export { ACTIONS, ACTION_CONTEXTS } from './actions';
export { KeybindingManager, createKeybindingManager } from './keybindings';
export { KEY_MAP } from './keymap';
export { validateKeybindings, KeybindingsSchema, KEYBINDING_CONTEXTS, KEYBINDING_ACTIONS } from './schema';
export { TEMPLATES, renderTemplate, getTemplateByName, listTemplates } from './template';
export { ConflictDetector, createConflictDetector, validateKeybindingsForConflicts } from './conflictDetector';
export { KeybindingManager as KeybindingManagerV2, createKeybindingManager as createKeybindingManagerV2, keybindingManager } from './keybindingManager';
export { validateKeybinding, validateKeybindings, validateTemplate, validateConfig, safeValidateKeybinding, safeValidateConfig } from './validation';
export { viModeTemplate, emacsModeTemplate, defaultModeTemplate, templates, getTemplateNames, getTemplate, getTemplateObject, mergeTemplates } from './templates';
export { TemplateManager, createTemplateManager, templateManager } from './templateManager';

export type { Action, ActionType, ActionContext } from './actions';
export type { Keybinding, KeybindingConfig } from './keybindings';
export type { KeyMapEntry } from './keymap';
export type { KeybindingsSchemaType, KeybindingContextName } from './schema';
export type { KeybindingTemplate, TemplateVariable } from './template';
export type { Conflict, ConflictDetectionResult, ConflictResolution } from './conflictDetector';
export type { KeybindingAction, RegisteredKeybinding } from './keybindingManager';
export type { KeybindingModeSchema, ActionTypeSchema, ContextSchema, KeybindingSchema, KeybindingsSchema, KeybindingTemplateSchema, KeybindingConfigSchema } from './validation';