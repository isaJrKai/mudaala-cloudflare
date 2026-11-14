const token = process.env.TELEGRAM_BOT_TOKEN
const secret = process.env.TELEGRAM_WEBHOOK_SECRET
if (!token || !secret) {
  console.error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in your environment.')
  process.exit(1)
}
if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
  console.error('TELEGRAM_WEBHOOK_SECRET must be 1–256 characters using letters, numbers, _ or -.')
  process.exit(1)
}
const response = await fetch('https://api.telegram.org/bot' + token + '/setWebhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    url: 'https://mudaala.store/api/telegram/webhook',
    secret_token: secret,
    allowed_updates: ['message'],
    drop_pending_updates: false,
  }),
})
const result = await response.json()
if (!response.ok || !result.ok) {
  console.error('Telegram webhook registration failed:', result.description || response.status)
  process.exit(1)
}
console.log('Telegram webhook registered for https://mudaala.store/api/telegram/webhook')
