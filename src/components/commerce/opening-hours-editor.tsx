'use client'

import { DAYS_OF_WEEK } from '@/lib/opening-hours'

type ScheduleMode = 'text' | 'daily' | 'weekdays' | 'weekends' | 'selected'

interface OpeningHoursEditorProps {
  value: string
  onChange: (value: string) => void
}

const WEEKDAYS = DAYS_OF_WEEK.slice(0, 5).map((day) => day.short)
const WEEKENDS = DAYS_OF_WEEK.slice(5).map((day) => day.short)
const ALL_DAYS = DAYS_OF_WEEK.map((day) => day.short)

function formatTime(value: string): string {
  const [hourText, minuteText] = value.split(':')
  const hour = Number(hourText)
  const minute = minuteText ?? '00'
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${minute} ${suffix}`
}

function parseTime(value: string): string | null {
  const match = value.match(/^(\d{1,2}):(\d{2}) (AM|PM)$/)
  if (!match) return null
  let hour = Number(match[1]) % 12
  if (match[3] === 'PM') hour += 12
  return `${String(hour).padStart(2, '0')}:${match[2]}`
}

function describeDays(days: string[], mode: ScheduleMode): string {
  if (mode === 'daily') return 'Daily'
  if (mode === 'weekdays') return 'Mon–Fri'
  if (mode === 'weekends') return 'Sat–Sun'
  return days.join(', ')
}

function serializeSchedule(days: string[], start: string, end: string, mode: ScheduleMode): string {
  if (!days.length || !start || !end) return ''
  return `${describeDays(days, mode)}, ${formatTime(start)}–${formatTime(end)}`
}

function parseSchedule(value: string): { mode: ScheduleMode; days: string[]; start: string; end: string } | null {
  const match = value.match(/^(.+), (\d{1,2}:\d{2} (?:AM|PM))–(\d{1,2}:\d{2} (?:AM|PM))$/)
  if (!match) return null
  const start = parseTime(match[2])
  const end = parseTime(match[3])
  if (!start || !end) return null

  let mode: ScheduleMode = 'selected'
  let days: string[]
  if (match[1] === 'Daily') {
    mode = 'daily'
    days = ALL_DAYS
  } else if (match[1] === 'Mon–Fri') {
    mode = 'weekdays'
    days = WEEKDAYS
  } else if (match[1] === 'Sat–Sun') {
    mode = 'weekends'
    days = WEEKENDS
  } else {
    days = match[1].split(', ')
    if (!days.length || days.some((day) => !ALL_DAYS.includes(day))) return null
  }
  return { mode, days, start, end }
}

export function OpeningHoursEditor({ value, onChange }: OpeningHoursEditorProps) {
  const parsed = parseSchedule(value)
  const mode = parsed?.mode ?? 'text'
  const days = parsed?.days ?? WEEKDAYS
  const start = parsed?.start ?? '09:00'
  const end = parsed?.end ?? '17:00'

  function chooseMode(nextMode: ScheduleMode) {
    if (nextMode === 'text') return
    const nextDays = nextMode === 'daily'
      ? ALL_DAYS
      : nextMode === 'weekdays'
        ? WEEKDAYS
        : nextMode === 'weekends'
          ? WEEKENDS
          : WEEKDAYS
    onChange(serializeSchedule(nextDays, start, end, nextMode))
  }

  function changeDays(day: string, checked: boolean) {
    const nextDays = checked
      ? ALL_DAYS.filter((candidate) => candidate === day || days.includes(candidate))
      : days.filter((candidate) => candidate !== day)
    if (!nextDays.length) return
    onChange(serializeSchedule(nextDays, start, end, 'selected'))
  }

  function changeTime(which: 'start' | 'end', nextValue: string) {
    const nextStart = which === 'start' ? nextValue : start
    const nextEnd = which === 'end' ? nextValue : end
    onChange(serializeSchedule(days, nextStart, nextEnd, mode))
  }

  return (
    <div className="space-y-2">
      <label htmlFor="bp-hours-mode" className="block text-xs font-medium text-muted-foreground">
        Choose a schedule or enter your own
      </label>
      <select
        id="bp-hours-mode"
        value={mode}
        onChange={(event) => chooseMode(event.target.value as ScheduleMode)}
        className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        <option value="text">Enter hours as text</option>
        <option value="daily">Daily</option>
        <option value="weekdays">Monday–Friday</option>
        <option value="weekends">Saturday–Sunday</option>
        <option value="selected">Choose individual days</option>
      </select>

      {mode === 'text' ? (
        <input
          id="bp-hours"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={120}
          placeholder="e.g. Mon–Sat, 7am–6pm"
          className="flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      ) : (
        <div className="space-y-3 rounded-md border bg-secondary/20 p-3">
          {mode === 'selected' ? (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Days your shop is open</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {DAYS_OF_WEEK.map((day) => (
                  <label key={day.short} className="flex min-h-10 items-center gap-2 rounded-md border bg-card px-2.5 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={days.includes(day.short)}
                      onChange={(event) => changeDays(day.short, event.target.checked)}
                      className="size-4 accent-primary"
                    />
                    {day.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <p className="text-sm text-muted-foreground">
              {mode === 'daily' ? 'Your shop is open every day.' : mode === 'weekdays' ? 'Your shop is open Monday to Friday.' : 'Your shop is open on Saturday and Sunday.'}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="bp-hours-open" className="text-sm font-medium">Opens</label>
              <input
                id="bp-hours-open"
                type="time"
                required
                value={start}
                onChange={(event) => changeTime('start', event.target.value)}
                className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="bp-hours-close" className="text-sm font-medium">Closes</label>
              <input
                id="bp-hours-close"
                type="time"
                required
                value={end}
                onChange={(event) => changeTime('end', event.target.value)}
                className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Times use your shop’s local time. You can switch back to custom text at any time.</p>
        </div>
      )}
    </div>
  )
}
