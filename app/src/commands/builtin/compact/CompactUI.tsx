import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface CompactUIProps {
  onDone?: () => void;
  args?: string;
}

export function CompactUI({ onDone, args = '' }: CompactUIProps) {
  return (
    <CommandUI
      commandName="compact"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'compactCommand', args)
      }
    />
  );
}
