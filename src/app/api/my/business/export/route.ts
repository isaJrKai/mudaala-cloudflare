import { NextResponse } from 'next/server'
import { route, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'

const BATCH_SIZE = 500
const MAX_EXPORT_ROWS = 25_000

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""'
  // Numeric cells remain numeric (including negative stock movements).
  // Escape formula-like user-controlled text to prevent spreadsheet injection.
  let text = String(value)
  if (typeof value === 'string' && (/^[=+@\t\r]/.test(text) || /^-/.test(text))) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}
function csv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export async function GET(request: Request) {
  return route(async () => {
    const user = await requireUser()
    const type = new URL(request.url).searchParams.get('type')
    if (type !== 'sales' && type !== 'stock') throw new ApiError(400, 'Choose sales or stock export')

    const total = type === 'sales'
      ? await db.businessSale.count({ where: { userId: user.id } })
      : await db.stockMovement.count({ where: { userId: user.id } })
    if (total > MAX_EXPORT_ROWS) {
      throw new ApiError(413, `This export contains more than ${MAX_EXPORT_ROWS.toLocaleString()} rows. Narrow your records before exporting.`)
    }

    const lines: Array<Array<string | number | null | undefined>> = []
    if (type === 'sales') {
      lines.push(['sale_id', 'occurred_at', 'status', 'product', 'quantity', 'unit', 'unit_price', 'unit_cost', 'currency', 'channel', 'recorded_amount', 'recognized_revenue', 'estimated_gross_profit', 'note', 'void_reason'])
      let skip = 0
      while (skip < total) {
        const batch = await db.businessSale.findMany({
          where: { userId: user.id },
          orderBy: { id: 'asc' },
          skip,
          take: BATCH_SIZE,
        })
        if (!batch.length) break
        for (const sale of batch) {
          const quantity = Number(sale.quantity.toString())
          const unitPrice = Number(sale.unitPrice.toString())
          const unitCost = sale.unitCost === null ? null : Number(sale.unitCost.toString())
          const amount = quantity * unitPrice
          const recognizedRevenue = sale.status === 'COMPLETED' ? amount : 0
          const grossProfit = sale.status === 'COMPLETED' && unitCost !== null ? quantity * (unitPrice - unitCost) : null
          lines.push([
            sale.id, sale.occurredAt.toISOString(), sale.status, sale.productTitle, quantity,
            sale.unit, unitPrice, unitCost, sale.currency, sale.channel, amount,
            recognizedRevenue, grossProfit, sale.note, sale.voidReason,
          ])
        }
        skip += batch.length
      }
    } else {
      lines.push(['movement_id', 'occurred_at', 'product', 'quantity_delta', 'unit', 'reason', 'note', 'linked_listing_id', 'linked_sale_id'])
      let skip = 0
      while (skip < total) {
        const batch = await db.stockMovement.findMany({
          where: { userId: user.id },
          orderBy: { id: 'asc' },
          skip,
          take: BATCH_SIZE,
        })
        if (!batch.length) break
        for (const movement of batch) {
          lines.push([
            movement.id, movement.occurredAt.toISOString(), movement.productTitle,
            Number(movement.quantityDelta.toString()), movement.unit, movement.reason,
            movement.note, movement.listingId, movement.saleId,
          ])
        }
        skip += batch.length
      }
    }

    return new NextResponse(csv(lines), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="mudaala-${type}-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })
}
