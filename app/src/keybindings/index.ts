// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
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
