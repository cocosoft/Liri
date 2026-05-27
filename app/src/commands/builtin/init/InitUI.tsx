import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface InitUIProps {
  onDone?: () => void;
  args?: string;
}

export function InitUI({ onDone, args = '' }: InitUIProps) {
  return (
    <CommandUI
      commandName="init"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'initCommand', args)
      }
    />
  );
}
