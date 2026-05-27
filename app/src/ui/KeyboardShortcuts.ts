/**
 * 键盘快捷键管理器
 *
 * 提供终端快捷键的注册和管理功能
 */

export interface KeyBinding {
  key: string;
  modifiers?: ('ctrl' | 'alt' | 'shift' | 'meta')[];
  description?: string;
  action: () => void | Promise<void>;
}

export interface KeySequence {
  sequence: string[];
  description?: string;
  action: () => void | Promise<void>;
}

export class KeyboardShortcuts {
  private static instance: KeyboardShortcuts | null = null;
  private bindings: Map<string, KeyBinding> = new Map();
  private sequences: KeySequence[] = [];
  private enabled: boolean = true;

  private constructor() {
    this.registerDefaultBindings();
  }

  static getInstance(): KeyboardShortcuts {
    if (!KeyboardShortcuts.instance) {
      KeyboardShortcuts.instance = new KeyboardShortcuts();
    }
    return KeyboardShortcuts.instance;
  }

  /**
   * 注册默认快捷键
   */
  private registerDefaultBindings(): void {
    this.registerBinding({
      key: 'c',
      modifiers: ['ctrl'],
      description: '中断当前操作',
      action: () => {
        console.log('Interrupt signal sent');
      },
    });

    this.registerBinding({
      key: 'z',
      modifiers: ['ctrl'],
      description: '撤销',
      action: () => {
        console.log('Undo action');
      },
    });

    this.registerBinding({
      key: 'd',
      modifiers: ['ctrl'],
      description: '复制',
      action: () => {
        console.log('Copy action');
      },
    });

    this.registerBinding({
      key: 'u',
      modifiers: ['ctrl'],
      description: '清除行',
      action: () => {
        console.log('Clear line');
      },
    });
  }

  /**
   * 注册快捷键绑定
   * @param binding 快捷键绑定
   */
  registerBinding(binding: KeyBinding): void {
    const key = this.getBindingKey(binding.key, binding.modifiers);
    this.bindings.set(key, binding);
  }

  /**
   * 注销快捷键绑定
   * @param key 按键
   * @param modifiers 修饰符
   */
  unregisterBinding(
    key: string,
    modifiers?: ('ctrl' | 'alt' | 'shift' | 'meta')[]
  ): void {
    const bindingKey = this.getBindingKey(key, modifiers);
    this.bindings.delete(bindingKey);
  }

  /**
   * 获取绑定键
   */
  private getBindingKey(
    key: string,
    modifiers?: ('ctrl' | 'alt' | 'shift' | 'meta')[]
  ): string {
    if (!modifiers || modifiers.length === 0) {
      return key.toLowerCase();
    }

    const sortedModifiers = [...modifiers].sort();
    return `${sortedModifiers.join('+')}+${key.toLowerCase()}`;
  }

  /**
   * 处理按键事件
   * @param key 按键
   * @param modifiers 修饰符
   */
  async handleKeyPress(
    key: string,
    modifiers?: ('ctrl' | 'alt' | 'shift' | 'meta')[]
  ): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    const bindingKey = this.getBindingKey(key, modifiers);
    const binding = this.bindings.get(bindingKey);

    if (binding) {
      await binding.action();
      return true;
    }

    return false;
  }

  /**
   * 注册按键序列
   * @param sequence 按键序列
   */
  registerSequence(sequence: KeySequence): void {
    this.sequences.push(sequence);
  }

  /**
   * 处理按键序列
   */
  async handleSequence(keys: string[]): Promise<boolean> {
    for (const sequence of this.sequences) {
      if (this.matchSequence(keys, sequence.sequence)) {
        await sequence.action();
        return true;
      }
    }
    return false;
  }

  /**
   * 匹配序列
   */
  private matchSequence(keys: string[], sequence: string[]): boolean {
    if (keys.length < sequence.length) {
      return false;
    }

    const lastN = keys.slice(-sequence.length);
    return lastN.every(
      (key, index) => key.toLowerCase() === sequence[index].toLowerCase()
    );
  }

  /**
   * 获取所有绑定
   */
  getAllBindings(): KeyBinding[] {
    return Array.from(this.bindings.values());
  }

  /**
   * 获取绑定描述
   */
  getBindingDescriptions(): Record<string, string> {
    const descriptions: Record<string, string> = {};

    for (const [key, binding] of this.bindings.entries()) {
      descriptions[key] = binding.description || key;
    }

    return descriptions;
  }

  /**
   * 启用快捷键
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * 禁用快捷键
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * 是否启用
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 清除所有绑定
   */
  clearAll(): void {
    this.bindings.clear();
    this.sequences = [];
  }

  /**
   * 重置为默认绑定
   */
  resetToDefaults(): void {
    this.bindings.clear();
    this.sequences = [];
    this.registerDefaultBindings();
  }

  /**
   * 格式化快捷键显示
   * @param key 按键
   * @param modifiers 修饰符
   */
  static formatKey(
    key: string,
    modifiers?: ('ctrl' | 'alt' | 'shift' | 'meta')[]
  ): string {
    if (!modifiers || modifiers.length === 0) {
      return key.toUpperCase();
    }

    const formattedModifiers = modifiers.map((m) => {
      switch (m) {
        case 'ctrl':
          return 'Ctrl';
        case 'alt':
          return 'Alt';
        case 'shift':
          return 'Shift';
        case 'meta':
          return 'Meta';
        default:
          return m;
      }
    });

    return [...formattedModifiers, key.toUpperCase()].join('+');
  }
}

export const keyboardShortcuts = KeyboardShortcuts.getInstance();

export default keyboardShortcuts;
