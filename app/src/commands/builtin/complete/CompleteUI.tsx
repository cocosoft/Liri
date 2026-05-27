import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface CompleteUIProps {
  onDone?: () => void;
  args?: string;
}

export function CompleteUI({ onDone, args = '' }: CompleteUIProps) {
  return (
    <CommandUI
      commandName="complete"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'completeCommand', args)
      }
    />
  );
}
