import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface PrivacySettingsUIProps {
  onDone?: () => void;
  args?: string;
}

export function PrivacySettingsUI({
  onDone,
  args = '',
}: PrivacySettingsUIProps) {
  return (
    <CommandUI
      commandName="privacy-settings"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('./index.js'),
          'privacySettingsCommand',
          args
        )
      }
    />
  );
}
