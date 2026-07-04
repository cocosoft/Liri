// canvas-editor/core/CommandManager.ts — undo/redo 栈管理

import { DrawCommand } from "../types";

export class CommandManager {
  private undoStack: DrawCommand[] = [];
  private redoStack: DrawCommand[] = [];
  private maxUndo = 100;
  private onChangeCb: (() => void) | null = null;

  /** 注册变更回调（撤销/重做/执行后自动触发） */
  onChange(cb: () => void) { this.onChangeCb = cb; }

  private notify() { this.onChangeCb?.(); }

  /** 执行新命令 → 入 undoStack */
  execute(cmd: DrawCommand) {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
    this.redoStack = [];
    this.notify();
  }

  /** 撤销 */
  undo(ctx: OffscreenCanvasRenderingContext2D): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.revert(ctx);
    this.redoStack.push(cmd);
    this.notify();
    return true;
  }

  /** 重做 */
  redo(ctx: OffscreenCanvasRenderingContext2D): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.apply(ctx);
    this.undoStack.push(cmd);
    this.notify();
    return true;
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  clear() { this.undoStack = []; this.redoStack = []; this.notify(); }
}
