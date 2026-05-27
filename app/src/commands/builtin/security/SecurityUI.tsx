import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface SecurityUIProps {
  onDone?: () => void;
  args?: string;
}

export function SecurityUI({ onDone, args = '' }: SecurityUIProps) {
  return (
    <CommandUI
      commandName="security"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'securityCommand', args)
      }
    />
  );
}
