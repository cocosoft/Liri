import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface HistoryUIProps {
  onDone?: () => void;
  args?: string;
}

export function HistoryUI({ onDone, args = '' }: HistoryUIProps) {
  return (
    <CommandUI
      commandName="history"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'historyCommand', args)
      }
    />
  );
}
