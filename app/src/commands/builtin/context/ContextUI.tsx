import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface ContextUIProps {
  onDone?: () => void;
  args?: string;
}

export function ContextUI({ onDone, args = '' }: ContextUIProps) {
  return (
    <CommandUI
      commandName="context"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'contextCommand', args)
      }
    />
  );
}
