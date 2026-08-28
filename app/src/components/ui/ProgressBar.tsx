/**
 * ProgressBar组件 - 进度条
 */

import React from 'react';
import { Text, Box } from '../ink.js';

type Color =
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'gray'
  | 'redBright'
  | 'greenBright'
  | 'yellowBright'
  | 'blueBright'
  | 'magentaBright'
  | 'cyanBright'
  | 'whiteBright'
  | 'hex'
  | 'bgBlack'
  | 'bgRed'
  | 'bgGreen'
  | 'bgYellow'
  | 'bgBlue'
  | 'bgMagenta'
  | 'bgCyan'
  | 'bgWhite'
  | 'bgHex';

interface ProgressBarProps {
  percent: number;
  width?: number;
  color?: Color;
  showLabel?: boolean;
}

const BLOCKS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];

export function ProgressBar({
  percent,
  width = 40,
  color = 'green',
  showLabel = true,
}: ProgressBarProps): React.ReactNode {
  // P3-3 根因防护：percent 先归一化到 [0,100]，条与 label 使用同一值（原实现条已 clamp 但 label 显示原始值，>100% 时条满而 label 溢出）
  const clamped = Math.min(100, Math.max(0, percent));
  const ratio = clamped / 100;
  const whole = Math.floor(ratio * width);

  let segments = [BLOCKS[BLOCKS.length - 1].repeat(whole)];

  if (whole < width) {
    const remainder = ratio * width - whole;
    const middle = Math.floor(remainder * BLOCKS.length);
    segments.push(BLOCKS[middle]);

    const empty = width - whole - 1;
    if (empty > 0) {
      segments.push(BLOCKS[0].repeat(empty));
    }
  }

  const bar = segments.join('');

  return (
    <Box>
      <Text color={color as Color}>{bar}</Text>
      {showLabel && <Text> {clamped}%</Text>}
    </Box>
  );
}

interface ProgressBarExProps extends ProgressBarProps {
  label?: string;
  filledColor?: Color;
  emptyColor?: Color;
}

export function ProgressBarEx({
  percent,
  width = 40,
  color = 'green',
  showLabel = true,
  label,
  filledColor,
  emptyColor,
}: ProgressBarExProps): React.ReactNode {
  // P3-3 根因防护：与 ProgressBar 一致，percent 归一化后 label/条同值
  const clamped = Math.min(100, Math.max(0, percent));
  const ratio = clamped / 100;
  const whole = Math.floor(ratio * width);

  let segments = [BLOCKS[BLOCKS.length - 1].repeat(whole)];

  if (whole < width) {
    const remainder = ratio * width - whole;
    const middle = Math.floor(remainder * BLOCKS.length);
    segments.push(BLOCKS[middle]);

    const empty = width - whole - 1;
    if (empty > 0) {
      segments.push(BLOCKS[0].repeat(empty));
    }
  }

  const bar = segments.join('');

  return (
    <Box flexDirection="column">
      {label && (
        <Text>
          {label}: {clamped}%
        </Text>
      )}
      <Box>
        <Text
          color={filledColor as Color}
          backgroundColor={emptyColor as Color}
        >
          {bar}
        </Text>
        {showLabel && <Text> {clamped}%</Text>}
      </Box>
    </Box>
  );
}
