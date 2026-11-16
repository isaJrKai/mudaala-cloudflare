export type TelegramApiMethod = 'sendMessage' | 'setChatMenuButton' | 'answerCallbackQuery' | 'getFile'

/**
 * Telegram API endpoint selection.
 *
 * Production always uses Telegram's official API host. A local mock host is
 * allowed only outside production so webhook and delivery flows can be tested
 * without sending real messages or exposing the bot token to arbitrary hosts.
 */
export function telegramApiUrl(token: string, method: TelegramApiMethod): string {
  const configuredBase = process.env.NODE_ENV === 'production'
    ? 'https://api.telegram.org'
    : process.env.TELEGRAM_API_BASE_URL || 'https://api.telegram.org'
  const base = configuredBase.replace(/\/+$/, '')
  return base + '/bot' + token + '/' + method
}
