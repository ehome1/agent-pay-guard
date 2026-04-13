import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { AgentStats } from '../adapters/types.js'

interface DailyRecord {
  date: string   // YYYY-MM-DD
  spent: number
  count: number
}

interface MonthlyRecord {
  month: string  // YYYY-MM
  spent: number
  count: number
}

interface AgentContext {
  daily: DailyRecord
  monthly: MonthlyRecord
  lastTransaction?: string
}

type ContextData = Record<string, AgentContext>

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

function freshDaily(): DailyRecord {
  return { date: today(), spent: 0, count: 0 }
}

function freshMonthly(): MonthlyRecord {
  return { month: currentMonth(), spent: 0, count: 0 }
}

function freshContext(): AgentContext {
  return { daily: freshDaily(), monthly: freshMonthly() }
}

/**
 * 本地 JSON 文件消费追踪器
 * 记录每个 Agent 的日/月累计消费，支持日期切换自动重置
 */
export class Tracker {
  private readonly filePath: string
  private data: ContextData

  constructor(baseDir: string) {
    this.filePath = join(baseDir, 'context.json')
    this.data = this.load()
  }

  private load(): ContextData {
    try {
      if (!existsSync(this.filePath)) {
        return {}
      }
      const raw = readFileSync(this.filePath, 'utf-8')
      return JSON.parse(raw) as ContextData
    } catch {
      // 文件损坏时安全降级
      return {}
    }
  }

  private save(): void {
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
  }

  private getOrCreate(agentId: string): AgentContext {
    let ctx = this.data[agentId]
    if (!ctx) {
      ctx = freshContext()
      this.data[agentId] = ctx
    }

    // 日期切换重置 daily
    if (ctx.daily.date !== today()) {
      ctx.daily = freshDaily()
    }

    // 月份切换重置 monthly
    if (ctx.monthly.month !== currentMonth()) {
      ctx.monthly = freshMonthly()
    }

    return ctx
  }

  /** 获取 Agent 当前日/月已消费金额 */
  getSpent(agentId: string): { dailySpent: number; monthlySpent: number } {
    const ctx = this.getOrCreate(agentId)
    return {
      dailySpent: ctx.daily.spent,
      monthlySpent: ctx.monthly.spent,
    }
  }

  /** 记录一笔放行的支付（累加消费） */
  record(agentId: string, amount: number): void {
    const ctx = this.getOrCreate(agentId)
    ctx.daily.spent += amount
    ctx.daily.count += 1
    ctx.monthly.spent += amount
    ctx.monthly.count += 1
    ctx.lastTransaction = new Date().toISOString()
    this.save()
  }

  /** 回退一笔消费（支付失败时调用） */
  rollback(agentId: string, amount: number): void {
    const ctx = this.getOrCreate(agentId)
    ctx.daily.spent = Math.max(0, ctx.daily.spent - amount)
    ctx.daily.count = Math.max(0, ctx.daily.count - 1)
    ctx.monthly.spent = Math.max(0, ctx.monthly.spent - amount)
    ctx.monthly.count = Math.max(0, ctx.monthly.count - 1)
    this.save()
  }

  /** 获取 Agent 消费统计（公开 API） */
  getStats(agentId: string): AgentStats {
    const ctx = this.getOrCreate(agentId)
    return {
      todaySpent: ctx.daily.spent,
      monthSpent: ctx.monthly.spent,
      todayCount: ctx.daily.count,
      lastTransaction: ctx.lastTransaction,
    }
  }
}
