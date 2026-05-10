import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface EffortUIProps {
  onDone?: () => void;
  args?: string;
}

export function EffortUI({ onDone, args = '' }: EffortUIProps) {
  return (
    <CommandUI
      commandName="effort"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'effortCommand', args)
      }
    />
  );
}
