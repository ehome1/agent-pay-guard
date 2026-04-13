import type { PaymentIntent, Decision } from '../adapters/types.js'
import type { AgentRuleConfig } from '../config/schema.js'
import type { Tracker } from '../context/tracker.js'

function allow(): Decision {
  return { allowed: true, timestamp: new Date().toISOString(), durationMs: 0 }
}

function deny(reason: string, ruleHit: string): Decision {
  return { allowed: false, reason, ruleHit, timestamp: new Date().toISOString(), durationMs: 0 }
}

function pendingApproval(reason: string): Decision {
  return {
    allowed: false,
    reason,
    ruleHit: 'human_approval',
    pendingHumanApproval: true,
    timestamp: new Date().toISOString(),
    durationMs: 0,
  }
}

/** 1. 协议控制 */
function checkProtocols(intent: PaymentIntent, rule: AgentRuleConfig): Decision | null {
  if (!rule.protocols || rule.protocols.length === 0) return null
  if (!rule.protocols.includes(intent.protocol)) {
    return deny(
      `协议 ${intent.protocol} 不在允许列表 [${rule.protocols.join(', ')}] 中`,
      'protocols',
    )
  }
  return null
}

/** 2. 时间窗口控制 */
function checkSchedule(_intent: PaymentIntent, rule: AgentRuleConfig): Decision | null {
  if (!rule.schedule) return null
  const { timezone, allowedHours, allowedDays } = rule.schedule

  const now = new Date()
  const tz = timezone || 'UTC'

  // 检查星期
  if (allowedDays && allowedDays.length > 0) {
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    const formatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz })
    const dayStr = formatter.format(now).toLowerCase().slice(0, 3)
    const dayKey = dayNames.includes(dayStr) ? dayStr : dayNames[now.getDay()]!
    if (!allowedDays.includes(dayKey)) {
      return deny(
        `当前星期 ${dayKey} 不在允许列表 [${allowedDays.join(', ')}] 中`,
        'schedule.allowed_days',
      )
    }
  }

  // 检查时间段
  if (allowedHours) {
    const match = allowedHours.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/)
    if (match) {
      const startH = parseInt(match[1]!, 10)
      const startM = parseInt(match[2]!, 10)
      const endH = parseInt(match[3]!, 10)
      const endM = parseInt(match[4]!, 10)

      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: tz,
      })
      const parts = timeFormatter.formatToParts(now)
      const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10)
      const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10)

      const nowMinutes = h * 60 + m
      const startMinutes = startH * 60 + startM
      const endMinutes = endH * 60 + endM

      if (nowMinutes < startMinutes || nowMinutes >= endMinutes) {
        return deny(
          `当前时间 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} 不在允许时段 ${allowedHours} 内`,
          'schedule.allowed_hours',
        )
      }
    }
  }

  return null
}

/** 3. 商户控制 */
function checkMerchants(intent: PaymentIntent, rule: AgentRuleConfig): Decision | null {
  if (!rule.merchants) return null
  const { mode, list } = rule.merchants
  const inList = list.includes(intent.merchant)

  if (mode === 'allow' && !inList) {
    return deny(
      `商户 ${intent.merchant} 不在白名单中`,
      'merchants.allow',
    )
  }
  if (mode === 'deny' && inList) {
    return deny(
      `商户 ${intent.merchant} 在黑名单中`,
      'merchants.deny',
    )
  }
  return null
}

/** 4. 类别控制 */
function checkCategories(intent: PaymentIntent, rule: AgentRuleConfig): Decision | null {
  if (!rule.categories) return null
  if (!intent.category) return null // 未提供类别时跳过

  const { mode, list } = rule.categories
  const inList = list.includes(intent.category)

  if (mode === 'allow' && !inList) {
    return deny(
      `类别 ${intent.category} 不在白名单中`,
      'categories.allow',
    )
  }
  if (mode === 'deny' && inList) {
    return deny(
      `类别 ${intent.category} 在黑名单中`,
      'categories.deny',
    )
  }
  return null
}

/** 5-7. 预算控制（需要 tracker） */
function checkBudget(
  intent: PaymentIntent,
  rule: AgentRuleConfig,
  tracker: Tracker,
): Decision | null {
  if (!rule.budget) return null

  // 5. 单笔上限
  if (rule.budget.perTransaction != null && intent.amount > rule.budget.perTransaction) {
    return deny(
      `单笔金额 ${intent.amount} 超过限额 ${rule.budget.perTransaction}`,
      'budget.per_transaction',
    )
  }

  const { dailySpent, monthlySpent } = tracker.getSpent(intent.agentId)

  // 6. 日累计
  if (rule.budget.daily != null && dailySpent + intent.amount > rule.budget.daily) {
    return deny(
      `日累计 ${dailySpent} + 本笔 ${intent.amount} = ${dailySpent + intent.amount} 超过日限额 ${rule.budget.daily}`,
      'budget.daily',
    )
  }

  // 7. 月累计
  if (rule.budget.monthly != null && monthlySpent + intent.amount > rule.budget.monthly) {
    return deny(
      `月累计 ${monthlySpent} + 本笔 ${intent.amount} = ${monthlySpent + intent.amount} 超过月限额 ${rule.budget.monthly}`,
      'budget.monthly',
    )
  }

  return null
}

/** 8. 人工审批 */
function checkHumanApproval(intent: PaymentIntent, rule: AgentRuleConfig): Decision | null {
  if (!rule.humanApproval) return null
  if (intent.amount > rule.humanApproval.above) {
    return pendingApproval(
      `金额 ${intent.amount} 超过人工审批线 ${rule.humanApproval.above}`,
    )
  }
  return null
}

/**
 * 执行全部声明式规则（按产品方案顺序）
 * 任一规则 deny → 立即返回
 */
export function checkDeclarativeRules(
  intent: PaymentIntent,
  rule: AgentRuleConfig,
  tracker: Tracker,
): Decision {
  const checks = [
    () => checkProtocols(intent, rule),
    () => checkSchedule(intent, rule),
    () => checkMerchants(intent, rule),
    () => checkCategories(intent, rule),
    () => checkBudget(intent, rule, tracker),
    () => checkHumanApproval(intent, rule),
  ]

  for (const check of checks) {
    const result = check()
    if (result !== null) {
      return result
    }
  }

  return allow()
}
