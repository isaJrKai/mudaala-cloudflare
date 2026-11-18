// GET /api/admin/directory - searchable, privacy-minimized platform directory.
import { route, jsonOk, ApiError } from '@/lib/api'
import { requireAdmin } from '@/lib/admin'
import { db } from '@/lib/db'
import type { NextRequest } from 'next/server'
const TYPES = ['PEOPLE', 'SHOPS', 'LISTINGS'] as const
function maskPhone(phone: string): string { const digits = phone.replace(/\\D/g, ''); return digits.length >= 4 ? '•••• ' + digits.slice(-4) : 'Hidden' }
export async function GET(request: NextRequest) {
 return route(async () => {
  await requireAdmin('Only the Mudaala admin can search the platform directory')
  const type = request.nextUrl.searchParams.get('type') ?? 'PEOPLE'
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 80)
  if (!TYPES.includes(type as typeof TYPES[number])) throw new ApiError(400, 'Invalid directory type')
  if (q.length < 2) return jsonOk({ type, query: q, results: [] })
  if (type === 'PEOPLE') {
   const rows = await db.user.findMany({ where: { isSeed: false, OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }, { profile: { is: { businessName: { contains: q, mode: 'insensitive' } } } }] }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, name: true, phone: true, createdAt: true, suspendedAt: true, suspensionReason: true, profile: { select: { businessName: true, shopCode: true, county: true } }, _count: { select: { listings: true, shopperEnquiries: true, merchantEnquiries: true } } } })
   return jsonOk({ type, query: q, results: rows.map(u => ({ id: u.id, name: u.name, phoneMasked: maskPhone(u.phone), joinedAt: u.createdAt, suspendedAt: u.suspendedAt, suspensionReason: u.suspensionReason, shop: u.profile, listingCount: u._count.listings, enquiryCount: u._count.shopperEnquiries + u._count.merchantEnquiries })) })
  }
  if (type === 'SHOPS') {
   const rows = await db.businessProfile.findMany({ where: { isSeed: false, OR: [{ businessName: { contains: q, mode: 'insensitive' } }, { shopCode: { contains: q, mode: 'insensitive' } }, { county: { contains: q, mode: 'insensitive' } }, { user: { name: { contains: q, mode: 'insensitive' } } }] }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, businessName: true, shopCode: true, county: true, area: true, createdAt: true, user: { select: { id: true, name: true, phone: true, suspendedAt: true, shopRestrictedAt: true, shopRestrictionReason: true, _count: { select: { listings: true } } } } } })
   return jsonOk({ type, query: q, results: rows.map(s => ({ id: s.id, businessName: s.businessName, shopCode: s.shopCode, county: s.county, area: s.area, createdAt: s.createdAt, ownerId: s.user.id, ownerName: s.user.name, ownerPhoneMasked: maskPhone(s.user.phone), listingCount: s.user._count.listings, suspendedAt: s.user.suspendedAt, shopRestrictedAt: s.user.shopRestrictedAt, shopRestrictionReason: s.user.shopRestrictionReason })) })
  }
  const rows = await db.listing.findMany({ where: { isSeed: false, OR: [{ title: { contains: q, mode: 'insensitive' } }, { id: q }, { user: { name: { contains: q, mode: 'insensitive' } } }, { user: { profile: { is: { businessName: { contains: q, mode: 'insensitive' } } } } }] }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, title: true, type: true, status: true, category: true, county: true, createdAt: true, user: { select: { name: true, profile: { select: { businessName: true, shopCode: true } } } } } })
  return jsonOk({ type, query: q, results: rows.map(l => ({ id: l.id, title: l.title, type: l.type, status: l.status, category: l.category, county: l.county, createdAt: l.createdAt, ownerName: l.user.name, shopName: l.user.profile?.businessName ?? null, shopCode: l.user.profile?.shopCode ?? null })) })
 })
}