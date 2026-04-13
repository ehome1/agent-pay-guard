import type { PaymentIntent, Decision } from '../adapters/types.js'
import type { SafetyConfig } from '../config/schema.js'
import { DEFAULT_SAFETY } from '../config/schema.js'

/**
 * 每个 agent 的频率限制追踪
 * key = agentId, value = 最近 1 分钟内的请求时间戳列表
 */
const rateLimitWindows = new Map<string, number[]>()

function allow(): Decision {
  return {
    allowed: true,
    timestamp: new Date().toISOString(),
    durationMs: 0, // 由上层调用者覆盖
  }
}

function deny(reason: string, ruleHit: string): Decision {
  return {
    allowed: false,
    reason,
    ruleHit,
    timestamp: new Date().toISOString(),
    durationMs: 0,
  }
}

function isRateLimited(agentId: string, limit: number): boolean {
  const now = Date.now()
  const windowMs = 60_000 // 1 分钟窗口

  let timestamps = rateLimitWindows.get(agentId)
  if (!timestamps) {
    timestamps = []
    rateLimitWindows.set(agentId, timestamps)
  }

  // 清理窗口外的时间戳
  const cutoff = now - windowMs
  while (timestamps.length > 0 && timestamps[0]! < cutoff) {
    timestamps.shift()
  }

  if (timestamps.length >= limit) {
    return true
  }

  timestamps.push(now)
  return false
}

/**
 * 检查内置安全底线规则
 * 这 4 条规则始终执行，开发者可调整参数但不可关闭
 */
export function checkSafety(
  intent: PaymentIntent,
  config?: Partial<SafetyConfig>,
): Decision {
  const safetyConfig: SafetyConfig = {
    ...DEFAULT_SAFETY,
    ...config,
  }

  // 规则 1: 拒绝无效金额
  if (intent.amount <= 0) {
    return deny(
      `金额无效: ${intent.amount}, 必须大于 0`,
      'reject_negative_amount',
    )
  }

  // 规则 2: 拒绝缺少 agentId
  if (!intent.agentId) {
    return deny(
      '缺少 agentId: 每笔支付必须标识发起的 Agent',
      'reject_missing_agent_id',
    )
  }

  // 规则 3: 单笔硬上限
  if (intent.amount > safetyConfig.maxTransactionHardCap) {
    return deny(
      `单笔金额 ${intent.amount} 超过硬上限 ${safetyConfig.maxTransactionHardCap}`,
      'max_transaction_hard_cap',
    )
  }

  // 规则 4: 频率限制
  if (isRateLimited(intent.agentId, safetyConfig.rateLimit)) {
    return deny(
      `Agent ${intent.agentId} 触发频率限制: ${safetyConfig.rateLimit}/min`,
      'rate_limit',
    )
  }

  return allow()
}

/** 清除频率限制状态（用于测试） */
export function resetRateLimits(): void {
  rateLimitWindows.clear()
}
