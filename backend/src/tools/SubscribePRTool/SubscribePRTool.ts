// @ts-nocheck
/**
 * PR订阅工具 SubscribePRTool（条件编译：KAIROS_GITHUB_WEBHOOKS）
 */
import { FEATURE_FLAGS } from '@modules/core/featureFlags';
const feature = (name: keyof typeof FEATURE_FLAGS) => FEATURE_FLAGS[name] ?? false;

export interface PRSubscription {
  id: string;
  repo: string;
  prNumber?: number;
  events: ('opened' | 'closed' | 'merged' | 'comment' | 'review')[];
  webhookUrl?: string;
  createdAt: number;
  active: boolean;
}

const subscriptions: PRSubscription[] = [];

export function isPRSubscriptionEnabled(): boolean {
  return feature('KAIROS_GITHUB_WEBHOOKS');
}

export function subscribeToPR(
  repo: string,
  events: ('opened' | 'closed' | 'merged' | 'comment' | 'review')[],
  prNumber?: number,
): PRSubscription | null {
  if (!isPRSubscriptionEnabled()) return null;

  const sub: PRSubscription = {
    id: `prsub_${Date.now()}`,
    repo,
    prNumber,
    events,
    createdAt: Date.now(),
    active: true,
  };
  subscriptions.push(sub);
  return sub;
}

export function getSubscriptions(repo?: string): PRSubscription[] {
  if (repo) return subscriptions.filter(s => s.repo === repo);
  return [...subscriptions];
}

export function unsubscribe(id: string): boolean {
  const idx = subscriptions.findIndex(s => s.id === id);
  if (idx === -1) return false;
  subscriptions.splice(idx, 1);
  return true;
}
