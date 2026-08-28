import type { brands, products, competitors } from '@prisma/client'

interface BrandWithRelations {
  brand: brands
  productCount: number
  competitorCount: number
}

const WEIGHTS = {
  name: 10,
  description: 15,
  website_url: 10,
  industry: 10,
  positioning: 15,
  value_proposition: 15,
  key_differentiators: 10,
  has_products: 10,
  has_competitors: 5,
}

export function computeCompleteness(data: BrandWithRelations): number {
  const { brand, productCount, competitorCount } = data
  let score = 0

  if (brand.name) score += WEIGHTS.name
  if (brand.description) score += WEIGHTS.description
  if (brand.website_url) score += WEIGHTS.website_url
  if (brand.industry) score += WEIGHTS.industry
  if (brand.positioning) score += WEIGHTS.positioning
  if (brand.value_proposition) score += WEIGHTS.value_proposition
  if (brand.key_differentiators?.length) score += WEIGHTS.key_differentiators
  if (productCount > 0) score += WEIGHTS.has_products
  if (competitorCount > 0) score += WEIGHTS.has_competitors

  return score
}
