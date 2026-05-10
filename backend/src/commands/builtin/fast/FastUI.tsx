import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface FastUIProps {
  onDone?: () => void;
  args?: string;
}

export function FastUI({ onDone, args = '' }: FastUIProps) {
  return (
    <CommandUI
      commandName="fast"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'fastCommand', args)
      }
    />
  );
}
