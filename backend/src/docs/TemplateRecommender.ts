import { TemplateService, type TemplateDefinition, type TemplateSearchFilter } from './TemplateService.js';

export interface TemplateScore {
  template: TemplateDefinition
  score: number
  reasons: string[]
}

export interface RecommendationContext {
  recentCategory?: string
  recentTags?: string[]
  preferredCategory?: string
  keyword?: string
}

export class TemplateRecommender {
  private templateService: TemplateService
  private usageCounts: Map<string, number> = new Map()
  private lastUsedAt: Map<string, number> = new Map()

  constructor(templateService?: TemplateService) {
    this.templateService = templateService || new TemplateService()
  }

  recommend(context?: RecommendationContext, limit: number = 5): TemplateScore[] {
    const all = this.templateService.getAllTemplates()
    if (all.length === 0) return []

    const scored: TemplateScore[] = all.map(t => {
      let score = 0
      const reasons: string[] = []

      const usage = this.usageCounts.get(t.id) || 0
      if (usage > 0) {
        score += Math.min(usage * 0.5, 3)
        reasons.push(`已使用 ${usage} 次`)
      }

      const lastUsed = this.lastUsedAt.get(t.id)
      if (lastUsed) {
        const hoursSinceUse = (Date.now() - lastUsed) / (1000 * 60 * 60)
        if (hoursSinceUse < 24) {
          score += 1
          reasons.push('最近使用过')
        } else if (hoursSinceUse < 168) {
          score += 0.5
          reasons.push('本周内使用过')
        }
      }

      if (context) {
        if (context.recentCategory && t.category === context.recentCategory) {
          score += 3
          reasons.push(`匹配分类: ${t.category}`)
        }

        if (context.preferredCategory && t.category === context.preferredCategory) {
          score += 2
          reasons.push(`偏好分类: ${t.category}`)
        }

        if (context.recentTags && context.recentTags.length > 0) {
          const tagOverlap = t.tags.filter(tag => context.recentTags!.includes(tag)).length
          if (tagOverlap > 0) {
            score += tagOverlap * 1.5
            reasons.push(`标签匹配: ${tagOverlap} 个`)
          }
        }

        if (context.keyword) {
          const kw = context.keyword.toLowerCase()
          if (t.name.toLowerCase().includes(kw)) {
            score += 3
            reasons.push('名称匹配关键词')
          }
          if (t.description.toLowerCase().includes(kw)) {
            score += 2
            reasons.push('描述匹配关键词')
          }
          if (t.tags.some(tag => tag.toLowerCase().includes(kw))) {
            score += 1.5
            reasons.push('标签匹配关键词')
          }
        }
      }

      const totalTemplates = all.length
      const categoryTemplates = all.filter(other => other.category === t.category).length
      const rarity = totalTemplates > 0 ? 1 - (categoryTemplates / totalTemplates) : 0
      score += rarity * 0.5

      return { template: t, score: Math.round(score * 100) / 100, reasons }
    })

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  recommendByCategory(category: string, limit: number = 5): TemplateScore[] {
    return this.recommend({ recentCategory: category }, limit)
  }

  recommendByKeyword(keyword: string, limit: number = 5): TemplateScore[] {
    return this.recommend({ keyword }, limit)
  }

  recordUsage(templateId: string): void {
    this.usageCounts.set(templateId, (this.usageCounts.get(templateId) || 0) + 1)
    this.lastUsedAt.set(templateId, Date.now())
  }

  getUsageStats(): { templateId: string; count: number; lastUsedAt: number }[] {
    const stats: { templateId: string; count: number; lastUsedAt: number }[] = []
    for (const [id, count] of this.usageCounts) {
      stats.push({ templateId: id, count, lastUsedAt: this.lastUsedAt.get(id) || 0 })
    }
    return stats.sort((a, b) => b.count - a.count)
  }

  reset(): void {
    this.usageCounts.clear()
    this.lastUsedAt.clear()
  }
}
