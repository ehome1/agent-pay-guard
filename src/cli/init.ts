import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { select, input } from '@inquirer/prompts'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 模板目录：打包后在 dist/cli/init.js，模板在 ../../templates/
// 开发时在 src/cli/init.ts，模板在 ../../templates/
function findTemplatesDir(): string {
  // 从当前文件向上找 templates 目录
  let dir = __dirname
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'templates')
    if (existsSync(candidate)) return candidate
    dir = dirname(dir)
  }
  throw new Error('找不到 templates 目录')
}

// 三套模板的关键参数摘要
const TEMPLATE_SUMMARIES: Record<string, { limits: string; merchants: string; extras: string }> = {
  conservative: {
    limits:    '$10/tx · $50/day · $500/mo',
    merchants: 'allowlist (only listed merchants pass)',
    extras:    'work hours only (Mon-Fri 08:00-20:00) · >$20 needs human approval',
  },
  standard: {
    limits:    '$50/tx · $500/day · $5,000/mo',
    merchants: 'denylist (all pass except blocked)',
    extras:    '>$100 needs human approval',
  },
  permissive: {
    limits:    '$100/tx · $2,000/day · $20,000/mo',
    merchants: 'denylist (empty — nothing blocked)',
    extras:    '>$500 needs human approval · 300 req/min rate limit',
  },
}

async function main() {
  console.log('\n🛡️  Agent Pay Guard — Init')
  console.log('   Pick a starting template. Every rule is customizable in guard.yaml after.\n')

  const templatesDir = findTemplatesDir()

  // 1. 选择模板（展示关键差异）
  const template = await select({
    message: 'Choose a rule template:',
    choices: [
      {
        name: 'conservative — strict limits, merchant allowlist, work-hours only',
        value: 'conservative',
        description: '$10/tx · $50/day · allowlist · Mon-Fri 08-20 · >$20 approval',
      },
      {
        name: 'standard — balanced limits, denylist, high-amount approval (recommended)',
        value: 'standard',
        description: '$50/tx · $500/day · denylist · >$100 approval',
      },
      {
        name: 'permissive — high limits, minimal restrictions',
        value: 'permissive',
        description: '$100/tx · $2,000/day · no merchant blocking · >$500 approval',
      },
    ],
  })

  // 2. Agent ID
  const agentId = await input({
    message: 'Your Agent ID (editable later in guard.yaml):',
    default: 'my-agent',
  })

  // 3. 读取模板并替换 Agent ID
  const templatePath = join(templatesDir, `${template}.yaml`)
  let content = readFileSync(templatePath, 'utf-8')
  content = content.replace(/my-agent/g, agentId)

  // 4. 检查目标文件
  const outputPath = resolve('guard.yaml')
  if (existsSync(outputPath)) {
    const overwrite = await select({
      message: 'guard.yaml already exists. Overwrite?',
      choices: [
        { name: 'Yes, overwrite', value: true },
        { name: 'No, cancel', value: false },
      ],
    })
    if (!overwrite) {
      console.log('Cancelled.')
      return
    }
  }

  // 5. 写入文件
  writeFileSync(outputPath, content, 'utf-8')

  // 6. 创建 .agent-pay-guard 目录
  const guardDir = resolve('.agent-pay-guard')
  mkdirSync(join(guardDir, 'logs'), { recursive: true })

  // 7. 打印配置摘要
  const summary = TEMPLATE_SUMMARIES[template]!
  console.log(`\n✅ Generated guard.yaml (template: ${template})`)
  console.log(`✅ Created .agent-pay-guard/ directory\n`)
  console.log('--- Your configuration ---')
  console.log(`  Agent:     ${agentId}`)
  console.log(`  Limits:    ${summary.limits}`)
  console.log(`  Merchants: ${summary.merchants}`)
  console.log(`  Extras:    ${summary.extras}`)
  console.log('')
  console.log('All values are fully customizable — edit guard.yaml to adjust.')
  console.log('')
  console.log('Next step — add to your code:\n')
  console.log('  import { Guard } from \'agent-pay-guard\'')
  console.log('  const guard = Guard.fromConfig()')
  console.log('  const decision = guard.check({ amount, currency, merchant, agentId, protocol })')
  console.log('')
}

main().catch((err) => {
  // 用户按 Ctrl+C 退出时不打印错误
  if (err instanceof Error && err.message.includes('User force closed')) {
    process.exit(0)
  }
  console.error(err)
  process.exit(1)
})
