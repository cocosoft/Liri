import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface ParallelUIProps {
  onDone?: () => void;
  args?: string;
}

export function ParallelUI({ onDone, args = '' }: ParallelUIProps) {
  return (
    <CommandUI
      commandName="parallel"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'parallelCommand', args)
      }
    />
  );
}
