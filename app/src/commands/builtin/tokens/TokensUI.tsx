import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface TokensUIProps {
  onDone?: () => void;
  args?: string;
}

export function TokensUI({ onDone, args = '' }: TokensUIProps) {
  return (
    <CommandUI
      commandName="tokens"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'tokensCommand',
          args
        )
      }
    />
  );
}
