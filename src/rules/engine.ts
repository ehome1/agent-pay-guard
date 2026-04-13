import type { PaymentIntent, Decision } from '../adapters/types.js'

/**
 * 规则函数签名
 * 返回 Decision：allowed=true 表示通过，继续检查下一条规则
 *               allowed=false 表示拒绝，立即短路
 */
export type RuleFn = (intent: PaymentIntent) => Decision

/**
 * 规则引擎：按序执行规则链
 * - 任意一条规则返回 Deny → 立即返回，不执行后续规则
 * - 全部 Pass → 返回 Allow
 * - 自动计算总耗时 durationMs
 */
export function runRuleChain(
  intent: PaymentIntent,
  rules: RuleFn[],
): Decision {
  const start = Date.now()

  for (const rule of rules) {
    const decision = rule(intent)
    if (!decision.allowed) {
      decision.durationMs = Date.now() - start
      return decision
    }
  }

  return {
    allowed: true,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - start,
  }
}
