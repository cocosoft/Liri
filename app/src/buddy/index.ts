export { EnhancedCompanionSystem } from './enhanced';
export { InteractionManager } from './interactions';
export type {
  InteractionAction,
  InteractionResult,
  InteractionEntry,
  InteractionHistory,
} from './interactions';
export { AttributeSystem, RARITY_FLOOR } from './attributes';
export type { AttributeDistribution } from './attributes';
export { CompanionSprite } from './CompanionSprite';
export { getCompanion, roll, rollWithSeed, companionUserId } from './companion';
export { companionIntroText, getCompanionIntroAttachment } from './prompt';
export { renderSprite, renderFace, spriteFrameCount } from './sprites';
export {
  isBuddyTeaserWindow,
  isBuddyLive,
  useBuddyNotification,
  findBuddyTriggerPositions,
} from './useBuddyNotification';
export {
  BUDDY_FLAGS,
  isBuddyEnabled,
  areBuddyNotificationsEnabled,
  areBuddyInteractionsEnabled,
  areBuddyStatsEnabled,
  isBuddyRarityEnabled,
  areBuddySpritesEnabled,
  isBuddyEnhancedEnabled,
  ifBuddyEnabled,
  ifNotificationsEnabled,
  ifInteractionsEnabled,
  getCompileFlagsJson,
  isBuddyFullyDisabled,
  hasAnyBuddyFeature,
  compileTimeAssert,
  validateBuddyDependencies,
} from './conditional';
export type { BuddyCompileFlags } from './conditional';
export {
  getNotificationManager,
  createHatchedNotification,
  createLevelUpNotification,
  createInteractionNotification,
  createAchievementNotification,
  createDailyCheckinNotification,
  createCelebrationNotification,
  createWarningNotification,
  createInfoNotification,
} from './notifications';
export type {
  NotificationType,
  NotificationPriority,
  BuddyNotification,
} from './notifications';
export {
  RARITIES,
  SPECIES,
  EYES,
  HATS,
  STAT_NAMES,
  RARITY_WEIGHTS,
  RARITY_STARS,
  RARITY_COLORS,
} from './types';
export type {
  Rarity,
  Species,
  Eye,
  Hat,
  StatName,
  CompanionBones,
  CompanionSoul,
  Companion,
  StoredCompanion,
} from './types';
// §5 向后兼容性保障 — 措施2：统一导出入口
// 旧模块的所有原始导出保持不变（上方 barrel export），
// 新增的插件包装通过兼容行引入，无需修改现有引用
export { createBuddyPlugin } from '../plugins/bundled/BuddyPlugin';

// ==================== 梦境集成（AutoDream × Buddy 联动） ====================
export {
  startDreamIntegration,
  stopDreamIntegration,
  initBuddyDreamIntegration,
  formatDreamMessage,
  formatGrowthDialogue,
  DreamGrowthTracker,
  DREAM_EVENT,
} from './dreamIntegration';
export type { DreamEvent, DreamEventType, DreamEventCallback } from '../chronos/autoDream/AutoDream';
