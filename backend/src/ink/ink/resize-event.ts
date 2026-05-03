import type { TerminalEvent } from './events/terminal-event.js';

export interface ResizeEvent extends TerminalEvent {
  type: 'resize';
  columns: number;
  rows: number;
}

export function isResizeEvent(event: TerminalEvent): event is ResizeEvent {
  return 'type' in event && (event as ResizeEvent).type === 'resize';
}
