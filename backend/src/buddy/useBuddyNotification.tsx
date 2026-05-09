import React, { useEffect } from 'react';
import { Text } from '../components/ink.js';
import { getRainbowColor } from '../utils/thinking';
import { getGlobalConfig } from '@modules/config';

export function isBuddyTeaserWindow(): boolean {
  const d = new Date();
  return d.getFullYear() === 2026 && d.getMonth() === 3 && d.getDate() <= 7;
}

export function isBuddyLive(): boolean {
  const d = new Date();
  return (
    d.getFullYear() > 2026 || (d.getFullYear() === 2026 && d.getMonth() >= 3)
  );
}

function RainbowText({ text }: { text: string }): React.ReactNode {
  return (
    <>
      {[...text].map((ch, i) => (
        <Text key={i} color={getRainbowColor(i)}>
          {ch}
        </Text>
      ))}
    </>
  );
}

export function useBuddyNotification(): void {
  useEffect(() => {
    if (!isBuddyTeaserWindow()) return;
    const config = getGlobalConfig();
    if (config.companion) return;

    const timeout = setTimeout(() => {
      console.log('/buddy - 试试/buddy命令来孵化一个伙伴！');
    }, 5000);

    return () => clearTimeout(timeout);
  }, []);
}

export function findBuddyTriggerPositions(text: string): Array<{
  start: number;
  end: number;
}> {
  const triggers: Array<{ start: number; end: number }> = [];
  const re = /\/buddy\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    triggers.push({
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return triggers;
}
