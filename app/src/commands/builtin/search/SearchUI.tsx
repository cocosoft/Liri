import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface SearchUIProps {
  onDone?: () => void;
  args?: string;
}

export function SearchUI({ onDone, args = '' }: SearchUIProps) {
  return (
    <CommandUI
      commandName="search"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'searchCommand',
          args
        )
      }
    />
  );
}
