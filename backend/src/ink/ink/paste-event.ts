//
import type { TerminalEvent } from './events/terminal-event.js';

export interface PasteEvent extends TerminalEvent {
  type: 'paste';
  data: string;
}

export function isPasteEvent(event: TerminalEvent): event is PasteEvent {
  return 'type' in event && (event as PasteEvent).type === 'paste';
}

export function createPasteEvent(data: string): PasteEvent {
  return { type: 'paste', data };
}
