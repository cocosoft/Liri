import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface ReleaseNotesUIProps {
  onDone?: () => void;
  args?: string;
}

export function ReleaseNotesUI({ onDone, args = '' }: ReleaseNotesUIProps) {
  return (
    <CommandUI
      commandName="release-notes"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'releaseNotesCommand',
          args
        )
      }
    />
  );
}
