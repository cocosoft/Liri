/**
 * Vim宏录制模块
 * 支持宏录制、播放和管理功能
 */

import { existsSync, readFileSync } from 'node:fs';

export interface MacroRecord {
  name: string;
  commands: string[];
  description?: string;
  timestamp: number;
}

export class MacroManager {
  private macros: Record<string, MacroRecord> = {};
  private recordingMacro: string | null = null;
  private recordingCommands: string[] = [];

  /**
   * 开始录制宏
   */
  startRecording(name: string): void {
    this.recordingMacro = name;
    this.recordingCommands = [];
  }

  /**
   * 停止录制宏
   */
  stopRecording(): MacroRecord | null {
    if (!this.recordingMacro) return null;

    const macro: MacroRecord = {
      name: this.recordingMacro,
      commands: [...this.recordingCommands],
      timestamp: Date.now(),
    };

    this.macros[this.recordingMacro] = macro;
    this.recordingMacro = null;
    this.recordingCommands = [];

    return macro;
  }

  /**
   * 添加命令到当前录制的宏
   */
  addCommand(command: string): void {
    if (this.recordingMacro) {
      this.recordingCommands.push(command);
    }
  }

  /**
   * 播放宏
   */
  play(name: string): string[] | null {
    const macro = this.macros[name];
    if (!macro) return null;
    return macro.commands;
  }

  /**
   * 删除宏
   */
  delete(name: string): boolean {
    if (this.macros[name]) {
      delete this.macros[name];
      return true;
    }
    return false;
  }

  /**
   * 获取所有宏列表
   */
  list(): MacroRecord[] {
    return Object.values(this.macros);
  }

  /**
   * 获取宏详情
   */
  get(name: string): MacroRecord | undefined {
    return this.macros[name];
  }

  /**
   * 检查是否正在录制
   */
  isRecording(): boolean {
    return this.recordingMacro !== null;
  }

  /**
   * 获取当前录制的宏名称
   */
  getRecordingName(): string | null {
    return this.recordingMacro;
  }

  /**
   * 保存宏到文件
   */
  saveToFile(filePath: string): void {
    const data = JSON.stringify(this.macros, null, 2);
    require('fs').writeFileSync(filePath, data, 'utf-8');
  }

  /**
   * 从文件加载宏
   */
  loadFromFile(filePath: string): void {
    if (existsSync(filePath)) {
      const data = readFileSync(filePath, 'utf-8');
      this.macros = JSON.parse(data);
    }
  }
}

/**
 * 创建宏管理器实例
 */
export function createMacroManager(): MacroManager {
  return new MacroManager();
}

/**
 * 全局宏管理器实例
 */
export const macroManager = createMacroManager();
