'use client'

import { useEffect, useState } from 'react'
import { BellRing, BellOff, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiGet, apiPost, apiFetch } from '@/lib/client'

type PublicKeyResponse = { publicKey: string }

function decodeApplicationServerKey(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(base64)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export function PushNotificationControl() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [supported, setSupported] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [unsupportedMessage, setUnsupportedMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    const frame = window.requestAnimationFrame(() => {
      const available = 'serviceWorker' in navigator
        && 'PushManager' in window
        && 'Notification' in window
      if (cancelled) return
      setSupported(available)
      if (!available) {
        setPermission('unsupported')
        setConfigured(false)
        const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent)
        const standalone = window.matchMedia('(display-mode: standalone)').matches
          || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
        setUnsupportedMessage(isAppleMobile && !standalone
          ? 'On iPhone or iPad, add Mudaala to your Home Screen first. Device alerts work from the installed app.'
          : 'This browser does not support device alerts. Your in-app notification centre will still work.')
        return
      }
      setPermission(Notification.permission)
      void apiGet<PublicKeyResponse>('/api/push-subscriptions').then(async () => {
        if (cancelled) return
        setConfigured(true)
        const registration = await navigator.serviceWorker.getRegistration('/')
        const subscription = await registration?.pushManager.getSubscription()
        if (!cancelled) setEnabled(Boolean(subscription))
      }).catch(() => {
        if (!cancelled) setConfigured(false)
      })
    })
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
    }
  }, [])

  async function enable() {
    setBusy(true)
    setMessage('')
    try {
      const result = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission()
      setPermission(result)
      if (result !== 'granted') {
        setMessage(result === 'denied' ? 'Notifications are blocked in your browser settings.' : 'You can enable device alerts whenever you are ready.')
        return
      }
      const { publicKey } = await apiGet<PublicKeyResponse>('/api/push-subscriptions')
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      const existing = await registration.pushManager.getSubscription()
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeApplicationServerKey(publicKey) as unknown as BufferSource,
      })
      await apiPost('/api/push-subscriptions', {
        ...subscription.toJSON(),
        expirationTime: subscription.expirationTime,
      })
      setEnabled(true)
      setMessage('Device alerts are on. You can change this anytime.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not enable device alerts.')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setMessage('')
    try {
      const registration = await navigator.serviceWorker.getRegistration('/')
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        await apiFetch('/api/push-subscriptions', {
          method: 'DELETE',
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
        await subscription.unsubscribe()
      }
      setEnabled(false)
      setMessage('Device alerts are off. In-app notifications will still be available.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not turn off device alerts.')
    } finally {
      setBusy(false)
    }
  }

  if (!supported) return unsupportedMessage ? <p className="border-t border-[#dfcfaa]/70 pt-3 text-[11px] leading-relaxed text-[#6b6c60]">{unsupportedMessage}</p> : null
  if (configured === false) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#dfcfaa]/70 pt-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[#174a35]">Phone & desktop alerts</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-[#6b6c60]">
          {enabled ? 'Device notifications are enabled on this browser.' : 'Get useful shop reminders even when Mudaala is closed.'}
        </p>
        {message ? <p className="mt-1 text-[11px] text-[#6b6c60]" role="status">{message}</p> : null}
      </div>
      <Button
        type="button"
        size="sm"
        variant={enabled ? 'outline' : 'default'}
        className={enabled ? 'h-9 gap-1.5 border-[#174a35]/25 text-[#174a35]' : 'h-9 gap-1.5 bg-[#174a35] text-white hover:bg-[#103b2a]'}
        onClick={() => { void (enabled ? disable() : enable()) }}
        disabled={busy || configured === null}
      >
        {busy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : enabled ? <BellOff className="size-3.5" aria-hidden /> : <BellRing className="size-3.5" aria-hidden />}
        {busy ? 'Please wait' : enabled ? 'Turn off' : 'Enable device alerts'}
      </Button>
      {permission === 'denied' ? <span className="sr-only">Browser permission is blocked.</span> : null}
    </div>
  )
}
