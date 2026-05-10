import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface ExitUIProps {
  onDone?: () => void;
  args?: string;
}

export function ExitUI({ onDone, args = '' }: ExitUIProps) {
  return (
    <CommandUI
      commandName="exit"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'exitCommand', args)
      }
    />
  );
}
