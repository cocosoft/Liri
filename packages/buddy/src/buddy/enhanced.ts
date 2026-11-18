import type { Companion } from './types';
import { roll, rollWithSeed, getCompanion, companionUserId } from './companion';
import {
  InteractionManager,
  type InteractionAction,
  type InteractionResult,
} from './interactions';
import { AttributeSystem, type AttributeDistribution } from './attributes';
import type { CompanionBones } from './types';

export class EnhancedCompanionSystem {
  public readonly interactionManager: InteractionManager;
  public readonly attributeSystem: AttributeSystem;

  constructor() {
    this.interactionManager = new InteractionManager();
    this.attributeSystem = new AttributeSystem();
  }

  roll(userId: string) {
    return roll(userId);
  }

  rollWithSeed(seed: string) {
    return rollWithSeed(seed);
  }

  getCompanion(): Companion | undefined {
    return getCompanion();
  }

  companionUserId(): string {
    return companionUserId();
  }

  async interact(
    companion: Companion,
    action: InteractionAction
  ): Promise<InteractionResult> {
    return this.interactionManager.execute(companion, action);
  }

  getAvailableInteractions(companion: Companion): InteractionAction[] {
    return this.interactionManager.getAvailableInteractions(companion);
  }

  trackInteractionHistory(companionId: string) {
    return this.interactionManager.trackInteractionHistory(companionId);
  }

  getInteractionCount(companionId: string): number {
    return this.interactionManager.getInteractionCount(companionId);
  }

  validateAttributes(attributes: Record<string, number>): boolean {
    return this.attributeSystem.validateAttributes(
      attributes as unknown as Record<string, number>
    );
  }

  getAttributeDistribution(samples: CompanionBones[]): AttributeDistribution {
    return this.attributeSystem.getAttributeDistribution(samples);
  }
}
