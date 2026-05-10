import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface BtwUIProps {
  onDone?: () => void;
  args?: string;
}

export function BtwUI({ onDone, args = '' }: BtwUIProps) {
  return (
    <CommandUI
      commandName="btw"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'btwCommand', args)
      }
    />
  );
}
