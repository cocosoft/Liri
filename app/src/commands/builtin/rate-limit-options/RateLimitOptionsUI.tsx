import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface RateLimitOptionsUIProps {
  onDone?: () => void;
  args?: string;
}

export function RateLimitOptionsUI({
  onDone,
  args = '',
}: RateLimitOptionsUIProps) {
  return (
    <CommandUI
      commandName="rate-limit-options"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'rateLimitOptionsCommand',
          args
        )
      }
    />
  );
}
