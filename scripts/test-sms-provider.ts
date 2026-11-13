import assert from 'node:assert/strict'
import { chooseSmsProvider } from '../src/lib/sms'

async function main() {
  const env = process.env as Record<string, string | undefined>
  const original = {
    nodeEnv: env.NODE_ENV,
    smsProvider: env.SMS_PROVIDER,
    apiKey: env.AT_API_KEY,
    username: env.AT_USERNAME,
  }
  const originalLog = console.log
  let consoleWrites = 0

  try {
    env.NODE_ENV = 'production'
    env.SMS_PROVIDER = 'console'
    delete env.AT_API_KEY
    delete env.AT_USERNAME
    console.log = () => { consoleWrites += 1 }

    const productionProvider = chooseSmsProvider()
    assert.equal(productionProvider.name, 'africas-talking', 'production must never select the console provider')
    await assert.rejects(
      productionProvider.send('+256700000000', 'test OTP 123456'),
      /SMS provider is not configured/,
      'production without SMS credentials must fail closed',
    )
    assert.equal(consoleWrites, 0, 'production OTPs must never be written to logs')

    env.NODE_ENV = 'test'
    env.SMS_PROVIDER = 'console'
    assert.equal(chooseSmsProvider().name, 'console', 'non-production tests may use the console provider')

    console.log = originalLog
    console.log('SMS provider security passed: production ignores the console override and fails closed without provider credentials.')
  } finally {
    console.log = originalLog
    if (original.nodeEnv === undefined) delete env.NODE_ENV; else env.NODE_ENV = original.nodeEnv
    if (original.smsProvider === undefined) delete env.SMS_PROVIDER; else env.SMS_PROVIDER = original.smsProvider
    if (original.apiKey === undefined) delete env.AT_API_KEY; else env.AT_API_KEY = original.apiKey
    if (original.username === undefined) delete env.AT_USERNAME; else env.AT_USERNAME = original.username
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
