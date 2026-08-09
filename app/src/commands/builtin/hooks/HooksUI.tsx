import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface HooksUIProps {
  onDone?: () => void;
  args?: string;
}

export function HooksUI({ onDone, args = '' }: HooksUIProps) {
  return (
    <CommandUI
      commandName="hooks"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'hooksCommand',
          args
        )
      }
    />
  );
}
