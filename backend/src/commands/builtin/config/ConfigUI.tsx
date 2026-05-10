import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface ConfigUIProps {
  onDone?: () => void;
  args?: string;
}

export function ConfigUI({ onDone, args = '' }: ConfigUIProps) {
  return (
    <CommandUI
      commandName="config"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'configCommand', args)
      }
    />
  );
}
