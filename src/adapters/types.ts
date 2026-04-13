/**
 * 统一支付意图对象
 * 无论底层是 Stripe 还是 x402，开发者传入这个标准结构
 */
export interface PaymentIntent {
  /** 支付金额（以最小货币单位表示，如美分） */
  amount: number
  /** 货币代码 */
  currency: string
  /** 收款方标识（域名、商户ID 或钱包地址） */
  merchant: string
  /** 发起支付的 Agent 标识 */
  agentId: string
  /** 支付协议类型 */
  protocol: 'stripe' | 'x402'
  /** 可选：商户类别（如 saas、api、retail） */
  category?: string
  /** 可选：本次支付的业务描述 */
  description?: string
  /** 可选：开发者附加的自定义字段 */
  metadata?: Record<string, unknown>
}

/** 决策结果 */
export interface Decision {
  /** 是否放行 */
  allowed: boolean
  /** 拒绝原因（allowed=false 时必有） */
  reason?: string
  /** 命中的规则名称 */
  ruleHit?: string
  /** 决策时间戳 */
  timestamp: string
  /** 本次决策耗时（ms） */
  durationMs: number
  /** 当需要人工审批时为 true */
  pendingHumanApproval?: boolean
}

/** Agent 消费统计 */
export interface AgentStats {
  /** 今日已消费金额（最小货币单位） */
  todaySpent: number
  /** 本月已消费金额 */
  monthSpent: number
  /** 今日交易笔数 */
  todayCount: number
  /** 最近一笔交易时间 */
  lastTransaction?: string
}
