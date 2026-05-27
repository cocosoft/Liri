//
/**
 * Keybindings模块导出文件
 */

export { ACTIONS, ACTION_CONTEXTS } from './actions';
export { KeybindingManager, createKeybindingManager } from './keybindings';
export { KEY_MAP } from './keymap';
export { KEYBINDING_CONTEXTS, KEYBINDING_ACTIONS } from './schema';
export {
  TEMPLATES,
  renderTemplate,
  getTemplateByName,
  listTemplates,
} from './template';
export {
  ConflictDetector,
  createConflictDetector,
  validateKeybindingsForConflicts,
} from './conflictDetector';
export {
  KeybindingManager as KeybindingManagerV2,
  createKeybindingManager as createKeybindingManagerV2,
  keybindingManager,
} from './keybindingManager';
export {
  viModeTemplate,
  emacsModeTemplate,
  defaultModeTemplate,
  templates,
  getTemplateNames,
  getTemplate,
  getTemplateObject,
  mergeTemplates,
} from './templates';
export { TemplateManager } from './templateManager';

export type { Action, ActionType, ActionContext } from './actions';
export type { Keybinding, KeybindingConfig } from './keybindings';
export type { KeyMapEntry } from './keymap';
export type { KeybindingContextName } from './types';
export type { KeybindingTemplate, TemplateVariable } from './template';
export type {
  Conflict,
  ConflictDetectionResult,
  ConflictResolution,
} from './conflictDetector';
export type {
  KeybindingAction,
  RegisteredKeybinding,
} from './keybindingManager';
