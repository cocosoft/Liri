import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface CheckpointUIProps {
  onDone?: () => void;
  args?: string;
}

export function CheckpointUI({ onDone, args = '' }: CheckpointUIProps) {
  return (
    <CommandUI
      commandName="checkpoint"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'checkpointCommand', args)
      }
    />
  );
}
