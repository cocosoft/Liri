import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface SecurityReviewUIProps {
  onDone?: () => void;
  args?: string;
}

export function SecurityReviewUI({ onDone, args = '' }: SecurityReviewUIProps) {
  return (
    <CommandUI
      commandName="security-review"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('./index.js'),
          'securityReviewCommand',
          args
        )
      }
    />
  );
}
