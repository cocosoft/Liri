import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface EnvUIProps {
  onDone?: () => void;
  args?: string;
}

export function EnvUI({ onDone, args = '' }: EnvUIProps) {
  return (
    <CommandUI
      commandName="env"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'envCommand', args)
      }
    />
  );
}
