// @ts-nocheck
/**
 * 按键绑定模板模块
 * 支持Vi、Emacs和默认模式的按键绑定模板
 */

import { KeybindingTemplateSchema, KeybindingsSchema } from './validation';

/**
 * Vi模式模板
 */
export const viModeTemplate: KeybindingsSchema = [
  // 移动
  { id: 'vi-move-up', key: 'k', action: { type: 'move', name: 'moveUp' }, context: 'editor', mode: 'vi' },
  { id: 'vi-move-down', key: 'j', action: { type: 'move', name: 'moveDown' }, context: 'editor', mode: 'vi' },
  { id: 'vi-move-left', key: 'h', action: { type: 'move', name: 'moveLeft' }, context: 'editor', mode: 'vi' },
  { id: 'vi-move-right', key: 'l', action: { type: 'move', name: 'moveRight' }, context: 'editor', mode: 'vi' },
  
  // 单词移动
  { id: 'vi-move-word', key: 'w', action: { type: 'move', name: 'moveWord' }, context: 'editor', mode: 'vi' },
  { id: 'vi-move-word-back', key: 'b', action: { type: 'move', name: 'moveWordBack' }, context: 'editor', mode: 'vi' },
  
  // 行首行尾
  { id: 'vi-move-line-start', key: '0', action: { type: 'move', name: 'moveLineStart' }, context: 'editor', mode: 'vi' },
  { id: 'vi-move-line-end', key: '$', action: { type: 'move', name: 'moveLineEnd' }, context: 'editor', mode: 'vi' },
  
  // 插入模式
  { id: 'vi-insert', key: 'i', action: { type: 'mode', name: 'enterInsertMode' }, context: 'editor', mode: 'vi' },
  { id: 'vi-insert-at-end', key: 'a', action: { type: 'mode', name: 'enterInsertModeAtEnd' }, context: 'editor', mode: 'vi' },
  
  // 删除
  { id: 'vi-delete-char', key: 'x', action: { type: 'edit', name: 'deleteChar' }, context: 'editor', mode: 'vi' },
  { id: 'vi-delete-word', key: 'd', modifier: ['d'], action: { type: 'edit', name: 'deleteWord' }, context: 'editor', mode: 'vi' },
  
  // 复制粘贴
  { id: 'vi-yank', key: 'y', action: { type: 'clipboard', name: 'copy' }, context: 'editor', mode: 'vi' },
  { id: 'vi-paste', key: 'p', action: { type: 'clipboard', name: 'paste' }, context: 'editor', mode: 'vi' },
  
  // 撤销重做
  { id: 'vi-undo', key: 'u', action: { type: 'undo', name: 'undo' }, context: 'editor', mode: 'vi' },
  { id: 'vi-redo', key: 'r', modifier: ['ctrl'], action: { type: 'undo', name: 'redo' }, context: 'editor', mode: 'vi' },
  
  // 搜索
  { id: 'vi-search-forward', key: '/', action: { type: 'search', name: 'search' }, context: 'editor', mode: 'vi' },
  { id: 'vi-search-next', key: 'n', action: { type: 'search', name: 'searchNext' }, context: 'editor', mode: 'vi' },
  
  // 退出
  { id: 'vi-exit', key: 'q', modifier: ['ctrl'], action: { type: 'command', name: 'quit' }, context: 'global', mode: 'vi' },
];

/**
 * Emacs模式模板
 */
export const emacsModeTemplate: KeybindingsSchema = [
  // 移动
  { id: 'emacs-move-up', key: 'p', modifier: ['ctrl'], action: { type: 'move', name: 'moveUp' }, context: 'editor', mode: 'emacs' },
  { id: 'emacs-move-down', key: 'n', modifier: ['ctrl'], action: { type: 'move', name: 'moveDown' }, context: 'editor', mode: 'emacs' },
  { id: 'emacs-move-left', key: 'b', modifier: ['ctrl'], action: { type: 'move', name: 'moveLeft' }, context: 'editor', mode: 'emacs' },
  { id: 'emacs-move-right', key: 'f', modifier: ['ctrl'], action: { type: 'move', name: 'moveRight' }, context: 'editor', mode: 'emacs' },
  
  // 单词移动
  { id: 'emacs-move-word', key: 'f', modifier: ['alt'], action: { type: 'move', name: 'moveWord' }, context: 'editor', mode: 'emacs' },
  { id: 'emacs-move-word-back', key: 'b', modifier: ['alt'], action: { type: 'move', name: 'moveWordBack' }, context: 'editor', mode: 'emacs' },
  
  // 行首行尾
  { id: 'emacs-move-line-start', key: 'a', modifier: ['ctrl'], action: { type: 'move', name: 'moveLineStart' }, context: 'editor', mode: 'emacs' },
  { id: 'emacs-move-line-end', key: 'e', modifier: ['ctrl'], action: { type: 'move', name: 'moveLineEnd' }, context: 'editor', mode: 'emacs' },
  
  // 删除
  { id: 'emacs-delete-char', key: 'd', modifier: ['ctrl'], action: { type: 'edit', name: 'deleteChar' }, context: 'editor', mode: 'emacs' },
  { id: 'emacs-delete-word', key: 'd', modifier: ['alt'], action: { type: 'edit', name: 'deleteWord' }, context: 'editor', mode: 'emacs' },
  
  // 复制粘贴
  { id: 'emacs-copy', key: 'w', modifier: ['ctrl'], action: { type: 'clipboard', name: 'copy' }, context: 'editor', mode: 'emacs' },
  { id: 'emacs-paste', key: 'y', modifier: ['ctrl'], action: { type: 'clipboard', name: 'paste' }, context: 'editor', mode: 'emacs' },
  
  // 撤销重做
  { id: 'emacs-undo', key: '/', modifier: ['ctrl'], action: { type: 'undo', name: 'undo' }, context: 'editor', mode: 'emacs' },
  
  // 搜索
  { id: 'emacs-search', key: 's', modifier: ['ctrl'], action: { type: 'search', name: 'search' }, context: 'editor', mode: 'emacs' },
  
  // 退出
  { id: 'emacs-exit', key: 'x', modifier: ['ctrl'], action: { type: 'command', name: 'quit' }, context: 'global', mode: 'emacs' },
];

/**
 * 默认模式模板
 */
export const defaultModeTemplate: KeybindingsSchema = [
  // 文件操作
  { id: 'default-new-file', key: 'n', modifier: ['ctrl'], action: { type: 'file', name: 'newFile' }, context: 'global', mode: 'default' },
  { id: 'default-open-file', key: 'o', modifier: ['ctrl'], action: { type: 'file', name: 'openFile' }, context: 'global', mode: 'default' },
  { id: 'default-save', key: 's', modifier: ['ctrl'], action: { type: 'file', name: 'save' }, context: 'editor', mode: 'default' },
  { id: 'default-save-all', key: 's', modifier: ['ctrl', 'shift'], action: { type: 'file', name: 'saveAll' }, context: 'global', mode: 'default' },
  
  // 编辑操作
  { id: 'default-undo', key: 'z', modifier: ['ctrl'], action: { type: 'undo', name: 'undo' }, context: 'editor', mode: 'default' },
  { id: 'default-redo', key: 'z', modifier: ['ctrl', 'shift'], action: { type: 'undo', name: 'redo' }, context: 'editor', mode: 'default' },
  { id: 'default-cut', key: 'x', modifier: ['ctrl'], action: { type: 'clipboard', name: 'cut' }, context: 'editor', mode: 'default' },
  { id: 'default-copy', key: 'c', modifier: ['ctrl'], action: { type: 'clipboard', name: 'copy' }, context: 'editor', mode: 'default' },
  { id: 'default-paste', key: 'v', modifier: ['ctrl'], action: { type: 'clipboard', name: 'paste' }, context: 'editor', mode: 'default' },
  { id: 'default-select-all', key: 'a', modifier: ['ctrl'], action: { type: 'select', name: 'selectAll' }, context: 'editor', mode: 'default' },
  
  // 窗口操作
  { id: 'default-close-tab', key: 'w', modifier: ['ctrl'], action: { type: 'window', name: 'closeTab' }, context: 'global', mode: 'default' },
  { id: 'default-next-tab', key: 'tab', modifier: ['ctrl'], action: { type: 'window', name: 'nextTab' }, context: 'global', mode: 'default' },
  { id: 'default-prev-tab', key: 'tab', modifier: ['ctrl', 'shift'], action: { type: 'window', name: 'prevTab' }, context: 'global', mode: 'default' },
  
  // 命令面板
  { id: 'default-command-palette', key: 'p', modifier: ['ctrl'], action: { type: 'command', name: 'commandPalette' }, context: 'global', mode: 'default' },
  
  // 设置
  { id: 'default-settings', key: ',', modifier: ['ctrl'], action: { type: 'command', name: 'settings' }, context: 'global', mode: 'default' },
];

/**
 * 获取所有模板
 */
export const templates = {
  vi: viModeTemplate,
  emacs: emacsModeTemplate,
  default: defaultModeTemplate,
};

/**
 * 获取模板名称列表
 */
export function getTemplateNames(): string[] {
  return Object.keys(templates);
}

/**
 * 获取指定模板
 */
export function getTemplate(name: string): KeybindingsSchema | null {
  return templates[name as keyof typeof templates] || null;
}

/**
 * 获取完整的模板对象
 */
export function getTemplateObject(name: string): KeybindingTemplateSchema | null {
  const bindings = getTemplate(name);
  if (!bindings) return null;

  const descriptions: Record<string, string> = {
    vi: 'Vi/Vim风格按键绑定',
    emacs: 'Emacs风格按键绑定',
    default: '默认按键绑定',
  };

  return {
    id: `template-${name}`,
    name: name,
    description: descriptions[name] || '',
    mode: name as 'vi' | 'emacs' | 'default',
    bindings,
  };
}

/**
 * 合并多个模板
 */
export function mergeTemplates(...templateNames: string[]): KeybindingsSchema {
  const result: KeybindingsSchema = [];
  const seen = new Set<string>();

  templateNames.forEach(name => {
    const template = getTemplate(name);
    if (template) {
      template.forEach(binding => {
        if (!seen.has(binding.id)) {
          seen.add(binding.id);
          result.push(binding);
        }
      });
    }
  });

  return result;
}
