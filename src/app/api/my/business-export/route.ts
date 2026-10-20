import { NextResponse } from 'next/server'
import { route, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = value instanceof Date ? value.toISOString() : String(value)
  // Prevent spreadsheet formula injection for exported user-controlled text.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

function csv(headers: string[], rows: unknown[][]): string {
  return [headers.map(cell).join(','), ...rows.map((row) => row.map(cell).join(','))].join('\r\n') + '\r\n'
}

export async function GET(request: Request) {
  return route(async () => {
    const user = await requireUser()
    const url = new URL(request.url)
    const type = url.searchParams.get('type') ?? 'sales'
    let body: string
    let filename: string

    if (type === 'sales') {
      const sales = await db.sale.findMany({
        where: { userId: user.id },
        include: { items: true },
        orderBy: { soldAt: 'desc' },
        take: 10_000,
      })
      body = csv(
        ['sale_id', 'status', 'channel', 'sold_at', 'currency', 'product', 'quantity', 'unit', 'unit_price', 'unit_cost', 'line_revenue', 'notes'],
        sales.flatMap((sale) => sale.items.map((item) => [
          sale.id, sale.status, sale.channel, sale.soldAt, sale.currency, item.productName,
          item.quantity.toString(), item.unit, item.unitPrice.toString(), item.unitCost?.toString() ?? '',
          item.lineTotal.toString(), sale.notes ?? '',
        ])),
      )
      filename = 'mudaala-sales.csv'
    } else if (type === 'products') {
      const products = await db.businessProduct.findMany({
        where: { userId: user.id },
        orderBy: [{ archived: 'asc' }, { name: 'asc' }],
        take: 10_000,
      })
      body = csv(
        ['product_id', 'name', 'sku', 'unit', 'currency', 'selling_price', 'cost_price', 'stock_on_hand', 'inventory_tracked', 'archived', 'updated_at'],
        products.map((product) => [
          product.id, product.name, product.sku, product.unit, product.currency, product.sellingPrice.toString(),
          product.costPrice?.toString() ?? '', product.stockOnHand.toString(), product.trackInventory, product.archived, product.updatedAt,
        ]),
      )
      filename = 'mudaala-products.csv'
    } else if (type === 'stock') {
      const movements = await db.stockMovement.findMany({
        where: { userId: user.id },
        include: { product: { select: { name: true, sku: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10_000,
      })
      body = csv(
        ['movement_id', 'product', 'sku', 'type', 'quantity_delta', 'sale_id', 'note', 'created_at'],
        movements.map((movement) => [
          movement.id, movement.product.name, movement.product.sku, movement.type,
          movement.quantityDelta.toString(), movement.saleId, movement.note, movement.createdAt,
        ]),
      )
      filename = 'mudaala-stock-movements.csv'
    } else {
      throw new ApiError(400, 'Choose sales, products, or stock for export')
    }

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })
}
