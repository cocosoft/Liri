/**
 * 帧类型定义 — 从 frame.ts 中提取，避免模块间循环依赖。
 *
 * 仅包含类型定义，不引用任何可能形成循环依赖的模块。
 */

export type FlickerReason = 'resize' | 'offscreen' | 'clear';

export type Patch =
  | { type: 'stdout'; content: string }
  | { type: 'clear'; count: number }
  | {
      type: 'clearTerminal';
      reason: FlickerReason;
      debug?: { triggerY: number; prevLine: string; nextLine: string };
    }
  | { type: 'cursorHide' }
  | { type: 'cursorShow' }
  | { type: 'cursorMove'; x: number; y: number }
  | { type: 'cursorTo'; col: number }
  | { type: 'carriageReturn' }
  | { type: 'hyperlink'; uri: string }
  | { type: 'styleStr'; str: string };

export type Diff = Patch[];
