import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from '../ink.js';
import { useAppState, useSetAppState } from '../state/AppState';
import { getCompanion } from './companion';
import { renderSprite, spriteFrameCount } from './sprites';
import { RARITY_COLORS, RARITY_STARS } from './types';

const TICK_MS = 500;
const BUBBLE_SHOW = 20;
const FADE_WINDOW = 6;
const PET_BURST_MS = 2500;

const IDLE_SEQUENCE = [0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 2, 0, 0, 0];

function SpeechBubble({ text, color, fading, tail }: {
  text: string;
  color: string;
  fading: boolean;
  tail: 'down' | 'up';
}): React.ReactNode {
  const tailChar = tail === 'down' ? 'v' : '^';

  return (
    <Box flexDirection="column" alignItems="center" marginBottom={1}>
      <Box>
        <Text color={color}>{' ┌'}{'─'.repeat(text.length + 2)}{'┐'}</Text>
      </Box>
      <Box>
        <Text color={color}>{' │ '}{text}{' │'}</Text>
      </Box>
      <Box>
        <Text color={color}>{' └'}{'─'.repeat(text.length + 2)}{'┘'}</Text>
      </Box>
      <Box>
        <Text color={color}>{'  '}{tailChar}</Text>
      </Box>
    </Box>
  );
}

export function CompanionSprite(): React.ReactNode {
  const [tick, setTick] = useState(0);
  const [hearts, setHearts] = useState<Array<{ id: number; x: number }>>([]);
  const heartIdRef = useRef(0);
  const companion = getCompanion();
  const companionReaction = useAppState((state) => state.companionReaction);
  const setState = useSetAppState();

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, TICK_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (companionReaction) {
      const timeout = setTimeout(() => {
        setState({ companionReaction: undefined });
      }, BUBBLE_SHOW * TICK_MS);
      return () => clearTimeout(timeout);
    }
  }, [companionReaction, setState]);

  useEffect(() => {
    const handlePet = () => {
      const id = heartIdRef.current++;
      setHearts((prev) => [...prev, { id, x: Math.random() * 10 - 5 }]);
      setTimeout(() => {
        setHearts((prev) => prev.filter((h) => h.id !== id));
      }, PET_BURST_MS);
    };

    window.addEventListener('buddy-pet', handlePet);
    return () => window.removeEventListener('buddy-pet', handlePet);
  }, []);

  if (!companion) {
    return null;
  }

  const frameIndex = IDLE_SEQUENCE[tick % IDLE_SEQUENCE.length] ?? 0;
  const actualFrame = frameIndex < 0 ? 0 : frameIndex;
  const spriteLines = renderSprite(companion, actualFrame);
  const rarityColor = RARITY_COLORS[companion.rarity] || 'inactive';
  const rarityStars = RARITY_STARS[companion.rarity] || '★';
  const bubbleTick = tick % (BUBBLE_SHOW + 10);
  const showBubble = companionReaction && bubbleTick < BUBBLE_SHOW;
  const isFading = bubbleTick >= BUBBLE_SHOW - FADE_WINDOW;

  return (
    <Box flexDirection="column" alignItems="center" marginTop={1}>
      {showBubble && (
        <SpeechBubble
          text={companionReaction}
          color={rarityColor}
          fading={isFading}
          tail="down"
        />
      )}

      {hearts.map((heart, i) => (
        <Box key={heart.id} marginLeft={heart.x}>
          <Text color="red">{' ♥'}</Text>
        </Box>
      ))}

      <Box flexDirection="column" alignItems="center">
        {spriteLines.map((line, i) => (
          <Box key={i}>
            <Text color={rarityColor}>{line}</Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text color={rarityColor}>
          {companion.name} {rarityStars}
        </Text>
      </Box>

      {companion.shiny && (
        <Box>
          <Text color="yellow">✨ 闪光 ✨</Text>
        </Box>
      )}
    </Box>
  );
}
