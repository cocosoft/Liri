//
/**
 * 按键绑定模板系统
 * 提供快捷键配置模板和变量替换功能
 */

import { z } from 'zod';
import { KeybindingsSchema, KeybindingsSchemaType, KEYBINDING_CONTEXTS, KEYBINDING_ACTIONS } from './schema';

export interface TemplateVariable {
  name: string;
  description: string;
  default: string;
  type: 'string' | 'number' | 'boolean';
}

export interface KeybindingTemplate {
  name: string;
  description: string;
  variables: TemplateVariable[];
  template: KeybindingsSchemaType;
}

export const DEFAULT_TEMPLATE_VARIABLES: TemplateVariable[] = [
  {
    name: 'leader',
    description: 'Leader key for prefix-based shortcuts',
    default: 'space',
    type: 'string',
  },
  {
    name: 'meta',
    description: 'Meta/Command key',
    default: 'cmd',
    type: 'string',
  },
  {
    name: 'ctrl',
    description: 'Control key',
    default: 'ctrl',
    type: 'string',
  },
  {
    name: 'alt',
    description: 'Alt/Option key',
    default: 'alt',
    type: 'string',
  },
  {
    name: 'shift',
    description: 'Shift key',
    default: 'shift',
    type: 'string',
  },
];

export const VI_MODE_TEMPLATE: KeybindingTemplate = {
  name: 'vi-mode',
  description: 'Vim-style keybindings',
  variables: DEFAULT_TEMPLATE_VARIABLES,
  template: {
    $schema: 'https://pyapp.dev/schemas/keybindings.json',
    $docs: 'https://pyapp.dev/docs/keybindings',
    bindings: [
      {
        context: 'Global',
        bindings: {
          'j': 'chat:cycleMode',
          'k': 'app:toggleTranscript',
          '{leader}+p': 'app:quickOpen',
          '{leader}+g': 'app:globalSearch',
        },
      },
      {
        context: 'Chat',
        bindings: {
          'escape': 'chat:cancel',
          'i': 'chat:newline',
          '{ctrl}+c': 'app:interrupt',
          '{ctrl}+d': 'app:exit',
          '{ctrl}+r': 'history:search',
        },
      },
    ],
  },
};

export const EMACS_MODE_TEMPLATE: KeybindingTemplate = {
  name: 'emacs-mode',
  description: 'Emacs-style keybindings',
  variables: DEFAULT_TEMPLATE_VARIABLES,
  template: {
    $schema: 'https://pyapp.dev/schemas/keybindings.json',
    $docs: 'https://pyapp.dev/docs/keybindings',
    bindings: [
      {
        context: 'Global',
        bindings: {
          '{ctrl}+x{ctrl}+f': 'app:quickOpen',
          '{ctrl}+x{ctrl}+s': 'app:save',
          '{ctrl}+x{ctrl}+c': 'app:exit',
          '{ctrl}+g': 'app:interrupt',
          '{meta}+x': 'app:globalSearch',
        },
      },
      {
        context: 'Chat',
        bindings: {
          '{ctrl}+a': 'app:clearLine',
          '{ctrl}+e': 'chat:submit',
          '{ctrl}+k': 'app:clearLine',
          '{ctrl}+u': 'app:clearLine',
          '{ctrl}+p': 'history:previous',
          '{ctrl}+n': 'history:next',
        },
      },
    ],
  },
};

export const DEFAULT_TEMPLATE: KeybindingTemplate = {
  name: 'default',
  description: 'Default keybindings',
  variables: DEFAULT_TEMPLATE_VARIABLES,
  template: {
    $schema: 'https://pyapp.dev/schemas/keybindings.json',
    $docs: 'https://pyapp.dev/docs/keybindings',
    bindings: [
      {
        context: 'Global',
        bindings: {
          '{ctrl}+c': 'app:interrupt',
          '{ctrl}+q': 'app:exit',
          '{ctrl}+k': 'app:clearScreen',
          '{ctrl}+l': 'app:redraw',
          '{ctrl}+p': 'app:quickOpen',
          '{ctrl}+k': 'app:globalSearch',
          '{ctrl}+s': 'app:save',
          '{ctrl}+shift+c': 'app:copyAll',
        },
      },
      {
        context: 'Chat',
        bindings: {
          'enter': 'chat:submit',
          '{ctrl}+enter': 'chat:newline',
          '{ctrl}+r': 'history:search',
          '{ctrl}+z': 'chat:undo',
          '{esc}': 'chat:cancel',
        },
      },
      {
        context: 'Autocomplete',
        bindings: {
          'enter': 'autocomplete:accept',
          '{ctrl}+n': 'autocomplete:next',
          '{ctrl}+p': 'autocomplete:previous',
          '{esc}': 'autocomplete:dismiss',
        },
      },
      {
        context: 'Confirmation',
        bindings: {
          'y': 'confirm:yes',
          'n': 'confirm:no',
          'enter': 'confirm:yes',
          '{esc}': 'confirm:no',
        },
      },
    ],
  },
};

export const TEMPLATES: KeybindingTemplate[] = [
  DEFAULT_TEMPLATE,
  VI_MODE_TEMPLATE,
  EMACS_MODE_TEMPLATE,
];

const VariableRegex = /\{(\w+)\}/g;

export function renderTemplate(
  template: KeybindingTemplate,
  variables?: Record<string, string>
): KeybindingsSchemaType {
  const resolvedVariables = {
    ...Object.fromEntries(
      template.variables.map((v) => [v.name, v.default])
    ),
    ...variables,
  };

  const jsonString = JSON.stringify(template.template);
  const renderedString = jsonString.replace(
    VariableRegex,
    (_match, varName) => {
      return resolvedVariables[varName] || varName;
    }
  );

  return JSON.parse(renderedString);
}

export function validateTemplate(template: KeybindingTemplate): {
  success: boolean;
  errors?: string[];
} {
  const errors: string[] = [];

  const rendered = renderTemplate(template);
  const validation = KeybindingsSchema.safeParse(rendered);

  if (!validation.success) {
    errors.push(`Template validation failed: ${validation.error.message}`);
  }

  for (const block of template.template.bindings) {
    if (!KEYBINDING_CONTEXTS.includes(block.context)) {
      errors.push(`Invalid context: ${block.context}`);
    }

    for (const action of Object.values(block.bindings)) {
      if (action !== null && !KEYBINDING_ACTIONS.includes(action)) {
        errors.push(`Invalid action: ${action}`);
      }
    }
  }

  return {
    success: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export function getTemplateByName(name: string): KeybindingTemplate | undefined {
  return TEMPLATES.find((t) => t.name === name);
}

export function listTemplates(): Array<{
  name: string;
  description: string;
}> {
  return TEMPLATES.map((t) => ({
    name: t.name,
    description: t.description,
  }));
}

export function createCustomTemplate(
  name: string,
  description: string,
  variables: TemplateVariable[],
  template: KeybindingsSchemaType
): KeybindingTemplate {
  return { name, description, variables, template };
}

export function mergeTemplates(
  baseTemplate: KeybindingTemplate,
  overrides: Partial<KeybindingsSchemaType>
): KeybindingTemplate {
  return {
    ...baseTemplate,
    template: {
      ...baseTemplate.template,
      ...overrides,
      bindings: overrides.bindings
        ? [...baseTemplate.template.bindings, ...overrides.bindings]
        : baseTemplate.template.bindings,
    },
  };
}