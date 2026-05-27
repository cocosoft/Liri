import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface ClearUIProps {
  onDone?: () => void;
  args?: string;
}

export function ClearUI({ onDone, args = '' }: ClearUIProps) {
  return (
    <CommandUI
      commandName="clear"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'clearCommand', args)
      }
    />
  );
}
