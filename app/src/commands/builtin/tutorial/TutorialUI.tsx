import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface TutorialUIProps {
  onDone?: () => void;
  args?: string;
}

export function TutorialUI({ onDone, args = '' }: TutorialUIProps) {
  return (
    <CommandUI
      commandName="tutorial"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'tutorialCommand',
          args
        )
      }
    />
  );
}
