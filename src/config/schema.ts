/** 安全底线配置（可在 YAML 中调整阈值，但不可关闭规则） */
export interface SafetyConfig {
  /** 单笔金额绝对上限（最小货币单位）。默认 10000 = $100 */
  maxTransactionHardCap: number
  /** 每分钟每 Agent 最大请求数。默认 60 */
  rateLimit: number
}

/** 预算控制 */
export interface BudgetConfig {
  /** 单笔上限（最小货币单位） */
  perTransaction?: number
  /** 日累计上限 */
  daily?: number
  /** 月累计上限 */
  monthly?: number
}

/** 白名单/黑名单控制 */
export interface ListConfig {
  mode: 'allow' | 'deny'
  list: string[]
}

/** 时间控制 */
export interface ScheduleConfig {
  timezone?: string
  allowedHours?: string
  allowedDays?: string[]
}

/** 人工审批 */
export interface HumanApprovalConfig {
  /** 超过此金额触发人工审批（最小货币单位） */
  above: number
}

/** 单个 Agent 的规则配置 */
export interface AgentRuleConfig {
  budget?: BudgetConfig
  merchants?: ListConfig
  categories?: ListConfig
  protocols?: Array<'stripe' | 'x402'>
  schedule?: ScheduleConfig
  humanApproval?: HumanApprovalConfig
}

/** guard.yaml 顶层配置结构 */
export interface GuardConfig {
  safety?: Partial<SafetyConfig>
  agents?: Record<string, AgentRuleConfig>
  default?: AgentRuleConfig
}

/** 安全底线默认值 */
export const DEFAULT_SAFETY: SafetyConfig = {
  maxTransactionHardCap: 10_000, // $100
  rateLimit: 60,
}
