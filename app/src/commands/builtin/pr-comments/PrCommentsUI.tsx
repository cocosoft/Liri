import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface PrCommentsUIProps {
  onDone?: () => void;
  args?: string;
}

export function PrCommentsUI({ onDone, args = '' }: PrCommentsUIProps) {
  return (
    <CommandUI
      commandName="pr-comments"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'prCommentsCommand',
          args
        )
      }
    />
  );
}
