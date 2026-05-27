import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface CommitPushPrUIProps {
  onDone?: () => void;
  args?: string;
}

export function CommitPushPrUI({ onDone, args = '' }: CommitPushPrUIProps) {
  return (
    <CommandUI
      commandName="commit-push-pr"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('./index.js'),
          'commitPushPrCommand',
          args
        )
      }
    />
  );
}
