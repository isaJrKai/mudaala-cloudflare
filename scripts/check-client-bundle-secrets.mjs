#!/usr/bin/env node
/**
 * Scan only files shipped to browsers for high-confidence secret patterns.
 * This is a guardrail, not a substitute for reviewing secrets in Git history.
 * Never print a matched value.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const roots = ['.next/static', 'public']
const textFile = /\.(?:js|mjs|cjs|json|map|html|css|txt)$/i
const patterns = [
  ['database URL with embedded credentials', /\bpostgres(?:ql)?:\/\/[^/\s"']+:[^@\s"']+@/i],
  ['AWS access key ID', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub access token', /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['private-key material', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['JWT-shaped credential', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['secret environment variable assigned a literal', /\b(?:CRON_SECRET|SETTINGS_ENCRYPTION_KEY|STORAGE_SECRET_ACCESS_KEY|AWS_SECRET_ACCESS_KEY|SUPABASE_SERVICE_ROLE_KEY)\b\s*[:=]\s*["'][^"']{12,}["']/i],
]

async function collectFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectFiles(fullPath))
    else if (entry.isFile() && textFile.test(entry.name)) files.push(fullPath)
  }
  return files
}

const findings = []
for (const root of roots) {
  try {
    if (!(await stat(root)).isDirectory()) continue
  } catch {
    if (root === '.next/static') {
      console.error('Client bundle secret scan failed: .next/static does not exist; run the production build first.')
      process.exit(2)
    }
    continue
  }
  for (const file of await collectFiles(root)) {
    const content = await readFile(file, 'utf8')
    for (const [label, pattern] of patterns) {
      if (pattern.test(content)) findings.push({ file: relative(process.cwd(), file), label })
    }
  }
}

if (findings.length) {
  for (const finding of findings) console.error('Potential ' + finding.label + ' in ' + finding.file)
  console.error('Client bundle secret scan failed with ' + findings.length + ' finding(s); matched values were not printed.')
  process.exit(1)
}

console.log('Client bundle secret scan passed: no high-confidence credential patterns found.')
