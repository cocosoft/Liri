/**
 * 向后兼容 - 所有类型和接口已迁移到 skillService
 *
 * 请从 "../services/skillService" 导入
 */
export {
  skillService as skillMarketService,
  type SkillSource,
  type Skill,
  type ClawHubSkillMeta,
  type InstalledSkill,
  type SkillSearchResult,
  type SkillCategory,
  type RecommendedResponse,
  type CategoryListResponse,
  type SourceDistribution,
} from "./skillService";
