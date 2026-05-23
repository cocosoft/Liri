import { getGlobalConfig } from '@modules/config';
import { getCompanion } from './companion';

export function companionIntroText(name: string, species: string): string {
  return `# 伙伴

一只名叫 ${name} 的小 ${species} 坐在用户输入框旁边，偶尔在气泡中发表评论。你不是 ${name} — 它是一个独立的观察者。

当用户直接（用名字）对 ${name} 说话时，它的气泡会回应。这时你的任务是保持克制：用一行或更少的文字回应，或者只回答消息中对你说的部分。不要解释你不是 ${name} — 用户知道。不要描述 ${name} 可能会说什么 — 由气泡处理。`;
}

export function getCompanionIntroAttachment(
  messages:
    | Array<{ type: string; attachment?: { type: string; name: string } }>
    | undefined
): Array<{ type: string; name: string; species: string }> {
  const companion = getCompanion();
  if (!companion || getGlobalConfig().companionMuted) return [];

  for (const msg of messages ?? []) {
    if (msg.type !== 'attachment') continue;
    if (msg.attachment?.type !== 'companion_intro') continue;
    if (msg.attachment?.name === companion.name) return [];
  }

  return [
    {
      type: 'companion_intro',
      name: companion.name,
      species: companion.species,
    },
  ];
}
