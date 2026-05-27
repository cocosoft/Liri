import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface AdvisorUIProps {
  onDone?: () => void;
  args?: string;
}

export function AdvisorUI({ onDone, args = '' }: AdvisorUIProps) {
  return (
    <CommandUI
      commandName="advisor"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'advisorCommand', args)
      }
    />
  );
}
