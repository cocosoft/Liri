import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface BriefUIProps {
  onDone?: () => void;
  args?: string;
}

export function BriefUI({ onDone, args = '' }: BriefUIProps) {
  return (
    <CommandUI
      commandName="brief"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'briefCommand', args)
      }
    />
  );
}
