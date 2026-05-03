/**
 * Vim寄存器模块
 * 支持多种寄存器类型和操作
 */

export type RegisterType = 'unnamed' | 'numbered' | 'named' | 'special';

export interface Register {
  name: string;
  type: RegisterType;
  content: string;
  isReadOnly?: boolean;
}

export class RegisterManager {
  private registers: Record<string, Register> = {};
  private unnamedContent: string = '';
  private yankContent: string = '';
  private deleteContent: string = '';

  constructor() {
    this.initializeRegisters();
  }

  /**
   * 初始化寄存器
   */
  private initializeRegisters(): void {
    // 命名寄存器 a-z
    for (let i = 97; i <= 122; i++) {
      const name = String.fromCharCode(i);
      this.registers[name] = {
        name,
        type: 'named',
        content: '',
      };
    }

    // 数字寄存器 0-9
    for (let i = 0; i <= 9; i++) {
      const name = String(i);
      this.registers[name] = {
        name,
        type: 'numbered',
        content: '',
        isReadOnly: i > 0,
      };
    }
  }

  /**
   * 设置无名寄存器内容
   */
  setUnnamed(content: string): void {
    this.unnamedContent = content;
    this.registers['0'] = {
      name: '0',
      type: 'numbered',
      content: this.yankContent,
      isReadOnly: true,
    };
  }

  /**
   * 获取无名寄存器内容
   */
  getUnnamed(): string {
    return this.unnamedContent;
  }

  /**
   * 设置指定寄存器内容
   */
  setRegister(name: string, content: string): boolean {
    const register = this.registers[name];
    if (!register) return false;
    if (register.isReadOnly) return false;

    register.content = content;
    return true;
  }

  /**
   * 获取指定寄存器内容
   */
  getRegister(name: string): string {
    const register = this.registers[name];
    if (!register) return '';
    return register.content;
  }

  /**
   * 复制到寄存器
   */
  yank(name: string, content: string): void {
    if (name === '') {
      this.yankContent = content;
      this.setUnnamed(content);
    } else {
      this.setRegister(name, content);
    }
  }

  /**
   * 删除到寄存器
   */
  delete(name: string, content: string): void {
    this.deleteContent = content;
    if (name === '') {
      this.setUnnamed(content);
    } else {
      this.setRegister(name, content);
    }
  }

  /**
   * 追加到寄存器
   */
  append(name: string, content: string): boolean {
    const register = this.registers[name];
    if (!register) return false;
    if (register.isReadOnly) return false;

    register.content += content;
    return true;
  }

  /**
   * 获取所有寄存器列表
   */
  getAllRegisters(): Register[] {
    return Object.values(this.registers);
  }

  /**
   * 获取指定类型的寄存器
   */
  getRegistersByType(type: RegisterType): Register[] {
    return Object.values(this.registers).filter(r => r.type === type);
  }

  /**
   * 获取数字寄存器内容
   */
  getNumberedRegisters(): Register[] {
    return this.getRegistersByType('numbered');
  }

  /**
   * 获取命名寄存器内容
   */
  getNamedRegisters(): Register[] {
    return this.getRegistersByType('named');
  }

  /**
   * 获取无名寄存器（特殊）
   */
  getUnnamedRegister(): Register {
    return {
      name: '"',
      type: 'unnamed',
      content: this.unnamedContent,
    };
  }

  /**
   * 获取删除寄存器
   */
  getDeleteRegister(): Register {
    return {
      name: '-',
      type: 'special',
      content: this.deleteContent,
    };
  }
}

/**
 * 创建寄存器管理器实例
 */
export function createRegisterManager(): RegisterManager {
  return new RegisterManager();
}

/**
 * 全局寄存器管理器实例
 */
export function createVimRegisters(): RegisterManager {
  return createRegisterManager();
}

export const registerManager = createRegisterManager();
