import { resolve, dirname } from 'node:path'
import type { PaymentIntent, Decision, AgentStats } from './adapters/types.js'
import type { GuardConfig, SafetyConfig, AgentRuleConfig } from './config/schema.js'
import { DEFAULT_SAFETY } from './config/schema.js'
import { loadConfig } from './config/loader.js'
import { checkSafety } from './rules/safety.js'
import { checkDeclarativeRules } from './rules/declarative.js'
import { runRuleChain, type RuleFn } from './rules/engine.js'
import { Tracker } from './context/tracker.js'
import { FileLogger } from './logger/file-logger.js'

export class Guard {
  private readonly safetyConfig: SafetyConfig
  private readonly config: GuardConfig
  private readonly tracker: Tracker
  private readonly logger: FileLogger

  private constructor(config: GuardConfig, baseDir: string) {
    this.config = config
    this.safetyConfig = {
      ...DEFAULT_SAFETY,
      ...config.safety,
    }
    const guardDir = resolve(baseDir, '.agent-pay-guard')
    this.tracker = new Tracker(guardDir)
    this.logger = new FileLogger(guardDir)
  }

  /**
   * 从 YAML 配置文件创建实例
   * @param configPath guard.yaml 路径，默认当前目录下 guard.yaml
   */
  static fromConfig(configPath = 'guard.yaml'): Guard {
    const absPath = resolve(configPath)
    let config: GuardConfig
    try {
      config = loadConfig(absPath)
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('配置文件不存在')) {
        config = {}
      } else {
        throw err
      }
    }
    return new Guard(config, dirname(absPath))
  }

  /**
   * 使用编程方式创建实例（不依赖文件）
   * @param config 配置对象
   * @param baseDir 存储目录（context.json / logs），默认 cwd
   */
  static create(config: GuardConfig = {}, baseDir = '.'): Guard {
    return new Guard(config, baseDir)
  }

  /** 获取指定 agentId 对应的规则（优先 agents[id]，否则 default） */
  private getRule(agentId: string): AgentRuleConfig | undefined {
    return this.config.agents?.[agentId] ?? this.config.default
  }

  /**
   * 检查一笔支付意图是否应该放行
   */
  check(intent: PaymentIntent): Decision {
    const rule = this.getRule(intent.agentId)

    // 记录 check 前的消费快照
    const { dailySpent: dailyBefore, monthlySpent: monthlyBefore } =
      this.tracker.getSpent(intent.agentId)

    const rules: RuleFn[] = [
      // ① 安全底线（始终最先执行）
      (i) => checkSafety(i, this.safetyConfig),
    ]

    // ② 声明式规则（有配置时才执行）
    if (rule) {
      rules.push((i) => checkDeclarativeRules(i, rule, this.tracker))
    }

    const decision = runRuleChain(intent, rules)

    // 放行时记录消费
    if (decision.allowed) {
      this.tracker.record(intent.agentId, intent.amount)
    }

    // 写审计日志
    const { dailySpent: dailyAfter, monthlySpent: monthlyAfter } =
      this.tracker.getSpent(intent.agentId)
    this.logger.log(intent, decision, {
      dailySpentBefore: dailyBefore,
      dailySpentAfter: dailyAfter,
      monthlySpentBefore: monthlyBefore,
      monthlySpentAfter: monthlyAfter,
    })

    return decision
  }

  /**
   * 支付失败时回退消费计数
   */
  rollback(intent: PaymentIntent): void {
    this.tracker.rollback(intent.agentId, intent.amount)
  }

  /**
   * 获取指定 Agent 的累计消费统计
   */
  getStats(agentId: string): AgentStats {
    return this.tracker.getStats(agentId)
  }
}
