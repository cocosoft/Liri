import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface HeapdumpUIProps {
  onDone?: () => void;
  args?: string;
}

export function HeapdumpUI({ onDone, args = '' }: HeapdumpUIProps) {
  return (
    <CommandUI
      commandName="heapdump"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'heapdumpCommand',
          args
        )
      }
    />
  );
}
