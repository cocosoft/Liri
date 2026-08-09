import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface ReviewUIProps {
  onDone?: () => void;
  args?: string;
}

export function ReviewUI({ onDone, args = '' }: ReviewUIProps) {
  return (
    <CommandUI
      commandName="review"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'reviewCommand',
          args
        )
      }
    />
  );
}
