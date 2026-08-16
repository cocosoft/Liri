/**
 * PrBadge组件 - PR状态徽章
 * 显示拉取请求的审核状态、合并状态等
 */

import React from 'react';
import { Text, Box } from '@modules/ink';

export type PrStatus =
  | 'open'
  | 'merged'
  | 'closed'
  | 'draft'
  | 'approved'
  | 'changes_requested'
  | 'conflict';

export interface ReviewInfo {
  /** 审核人 */
  reviewer: string;
  /** 审核状态 */
  status: 'approved' | 'changes_requested' | 'pending' | 'commented';
}

export interface PrBadgeProps {
  /** PR编号 */
  number: number;
  /** PR标题 */
  title: string;
  /** PR状态 */
  status: PrStatus;
  /** 作者 */
  author?: string;
  /** 分支信息 */
  branch?: {
    source: string;
    target: string;
  };
  /** 审核信息 */
  reviews?: ReviewInfo[];
  /** 文件变更数 */
  changes?: {
    files: number;
    additions: number;
    deletions: number;
  };
  /** CI状态 */
  ciStatus?: 'passing' | 'failing' | 'pending' | 'unknown';
  /** 是否精简显示 */
  compact?: boolean;
}

const statusConfig: Record<
  PrStatus,
  { label: string; icon: string; color: string }
> = {
  open: { label: 'Open', icon: '○', color: 'green' },
  merged: { label: 'Merged', icon: '◉', color: 'magenta' },
  closed: { label: 'Closed', icon: '✕', color: 'red' },
  draft: { label: 'Draft', icon: '◐', color: 'gray' },
  approved: { label: 'Approved', icon: '✓', color: 'green' },
  changes_requested: { label: 'Changes', icon: '✕', color: 'red' },
  conflict: { label: 'Conflict', icon: '⚠', color: 'yellow' },
};

const ciConfig: Record<string, { icon: string; color: string }> = {
  passing: { icon: '✓', color: 'green' },
  failing: { icon: '✕', color: 'red' },
  pending: { icon: '◐', color: 'yellow' },
  unknown: { icon: '?', color: 'gray' },
};

function ReviewIcons({ reviews }: { reviews: ReviewInfo[] }): React.ReactNode {
  if (!reviews || reviews.length === 0) return null;

  const icons: Record<string, string> = {
    approved: '✓',
    changes_requested: '✕',
    pending: '○',
    commented: '💬',
  };

  return (
    <Box>
      {reviews.map((review, idx) => (
        <Text
          key={idx}
          color={
            review.status === 'approved'
              ? 'green'
              : review.status === 'changes_requested'
                ? 'red'
                : 'gray'
          }
        >
          {icons[review.status] || '○'}
        </Text>
      ))}
    </Box>
  );
}

export function PrBadge({
  number,
  title,
  status,
  author,
  branch,
  reviews,
  changes,
  ciStatus,
  compact = false,
}: PrBadgeProps): React.ReactNode {
  const cfg = statusConfig[status];

  if (compact) {
    return (
      <Box>
        <Text color={cfg.color}>{cfg.icon}</Text>
        <Text> </Text>
        <Text color="gray" dim>
          #{number}
        </Text>
        <Text> </Text>
        <Text bold>{title.slice(0, 50)}</Text>
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={cfg.color as any}
      paddingX={1}
      paddingY={0}
      flexDirection="column"
    >
      <Box>
        <Text bold color={cfg.color}>
          #{number}
        </Text>
        <Text> </Text>
        <Text>{title}</Text>
      </Box>
      <Box>
        <Text color={cfg.color}>[{cfg.label}]</Text>
        {branch && (
          <>
            <Text> </Text>
            <Text color="gray" dim>
              {branch.source} → {branch.target}
            </Text>
          </>
        )}
        {author && (
          <>
            <Text> </Text>
            <Text color="gray" dim>
              by {author}
            </Text>
          </>
        )}
      </Box>
      <Box>
        {changes && (
          <Text color="gray" dim>
            {'📄'}
            {changes.files} files{' '}
            <Text color="green">+{changes.additions}</Text>{' '}
            <Text color="red">-{changes.deletions}</Text>
          </Text>
        )}
        {ciStatus && (
          <>
            <Text> </Text>
            <Text color={ciConfig[ciStatus].color}>
              {'CI:'}
              {ciConfig[ciStatus].icon}
            </Text>
          </>
        )}
        {reviews && reviews.length > 0 && (
          <>
            <Text> </Text>
            <ReviewIcons reviews={reviews} />
          </>
        )}
      </Box>
    </Box>
  );
}
