import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import Ajv, { type ErrorObject } from 'ajv'
import type {
  GuardConfig,
  AgentRuleConfig,
  BudgetConfig,
  ListConfig,
  ScheduleConfig,
  HumanApprovalConfig,
} from './schema.js'

/**
 * guard.yaml 的 JSON Schema
 * 用于校验配置文件的结构和类型
 */
const guardConfigSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    safety: {
      type: 'object',
      additionalProperties: false,
      properties: {
        max_transaction_hard_cap: { type: 'number', minimum: 1 },
        rate_limit: { type: 'number', minimum: 1 },
      },
    },
    agents: {
      type: 'object',
      patternProperties: {
        '^.+$': { $ref: '#/$defs/agentRule' },
      },
    },
    default: { $ref: '#/$defs/agentRule' },
  },
  $defs: {
    agentRule: {
      type: 'object',
      additionalProperties: false,
      properties: {
        budget: {
          type: 'object',
          additionalProperties: false,
          properties: {
            per_transaction: { type: 'number', minimum: 0 },
            daily: { type: 'number', minimum: 0 },
            monthly: { type: 'number', minimum: 0 },
          },
        },
        merchants: {
          type: 'object',
          additionalProperties: false,
          required: ['mode', 'list'],
          properties: {
            mode: { type: 'string', enum: ['allow', 'deny'] },
            list: { type: 'array', items: { type: 'string' } },
          },
        },
        categories: {
          type: 'object',
          additionalProperties: false,
          required: ['mode', 'list'],
          properties: {
            mode: { type: 'string', enum: ['allow', 'deny'] },
            list: { type: 'array', items: { type: 'string' } },
          },
        },
        protocols: {
          type: 'array',
          items: { type: 'string', enum: ['stripe', 'x402'] },
        },
        schedule: {
          type: 'object',
          additionalProperties: false,
          properties: {
            timezone: { type: 'string' },
            allowed_hours: { type: 'string', pattern: '^\\d{2}:\\d{2}-\\d{2}:\\d{2}$' },
            allowed_days: {
              type: 'array',
              items: { type: 'string', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
            },
          },
        },
        human_approval: {
          type: 'object',
          additionalProperties: false,
          required: ['above'],
          properties: {
            above: { type: 'number', minimum: 0 },
          },
        },
      },
    },
  },
} as const

const ajv = new Ajv({ allErrors: true })
const validate = ajv.compile(guardConfigSchema)

/** 将 YAML 中 snake_case 的 agent 规则转换为代码中 camelCase */
function transformAgentRule(raw: Record<string, unknown>): AgentRuleConfig {
  const result: AgentRuleConfig = {}

  if (raw['budget']) {
    const b = raw['budget'] as Record<string, unknown>
    const budget: BudgetConfig = {}
    if (b['per_transaction'] != null) budget.perTransaction = b['per_transaction'] as number
    if (b['daily'] != null) budget.daily = b['daily'] as number
    if (b['monthly'] != null) budget.monthly = b['monthly'] as number
    result.budget = budget
  }

  if (raw['merchants']) {
    result.merchants = raw['merchants'] as ListConfig
  }

  if (raw['categories']) {
    result.categories = raw['categories'] as ListConfig
  }

  if (raw['protocols']) {
    result.protocols = raw['protocols'] as Array<'stripe' | 'x402'>
  }

  if (raw['schedule']) {
    const s = raw['schedule'] as Record<string, unknown>
    const schedule: ScheduleConfig = {}
    if (s['timezone'] != null) schedule.timezone = s['timezone'] as string
    if (s['allowed_hours'] != null) schedule.allowedHours = s['allowed_hours'] as string
    if (s['allowed_days'] != null) schedule.allowedDays = s['allowed_days'] as string[]
    result.schedule = schedule
  }

  if (raw['human_approval']) {
    const h = raw['human_approval'] as Record<string, unknown>
    result.humanApproval = { above: h['above'] as number } satisfies HumanApprovalConfig
  }

  return result
}

function formatErrors(errors: ErrorObject[]): string {
  return errors
    .map((e) => {
      const path = e.instancePath || '(root)'
      return `  - ${path}: ${e.message}`
    })
    .join('\n')
}

/**
 * 从 YAML 文件加载并校验 guard 配置
 * @throws 文件不存在、YAML 语法错误、Schema 校验失败时抛出
 */
export function loadConfig(configPath: string): GuardConfig {
  let raw: string
  try {
    raw = readFileSync(configPath, 'utf-8')
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      throw new Error(`配置文件不存在: ${configPath}`)
    }
    throw err
  }

  if (!raw.trim()) {
    throw new Error(`配置文件为空: ${configPath}`)
  }

  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`YAML 解析失败: ${msg}`)
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`配置文件格式错误: 期望 object，得到 ${typeof parsed}`)
  }

  const valid = validate(parsed)
  if (!valid && validate.errors) {
    throw new Error(
      `配置校验失败 (${configPath}):\n${formatErrors(validate.errors)}`,
    )
  }

  const data = parsed as Record<string, unknown>
  const config: GuardConfig = {}

  // safety
  if (data['safety']) {
    const s = data['safety'] as Record<string, unknown>
    config.safety = {}
    if (s['max_transaction_hard_cap'] != null) {
      config.safety.maxTransactionHardCap = s['max_transaction_hard_cap'] as number
    }
    if (s['rate_limit'] != null) {
      config.safety.rateLimit = s['rate_limit'] as number
    }
  }

  // agents
  if (data['agents']) {
    const agents = data['agents'] as Record<string, Record<string, unknown>>
    config.agents = {}
    for (const [id, raw] of Object.entries(agents)) {
      config.agents[id] = transformAgentRule(raw)
    }
  }

  // default
  if (data['default']) {
    config.default = transformAgentRule(data['default'] as Record<string, unknown>)
  }

  return config
}
