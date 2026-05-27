import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface SessionUIProps {
  onDone?: () => void;
  args?: string;
}

export function SessionUI({ onDone, args = '' }: SessionUIProps) {
  return (
    <CommandUI
      commandName="session"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'sessionCommand', args)
      }
    />
  );
}
