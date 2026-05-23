import React from 'react';
import { render } from '../ink';
import { ReplApp } from './ReplApp';
import type { ChatManager } from '@modules/chat/ChatManager';

export async function launchInkRepl(chatManager: ChatManager): Promise<void> {
  const instance = await render(
    React.createElement(ReplApp, {
      chatManager,
      onExit: () => {},
    })
  );

  await instance.waitUntilExit();
}
