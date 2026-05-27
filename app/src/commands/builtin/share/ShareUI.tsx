import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface ShareUIProps {
  onDone?: () => void;
  args?: string;
}

export function ShareUI({ onDone, args = '' }: ShareUIProps) {
  return (
    <CommandUI
      commandName="share"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'shareCommand', args)
      }
    />
  );
}
