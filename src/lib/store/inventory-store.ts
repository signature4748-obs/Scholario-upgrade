/**
 * Inventory store — connected school inventory management.
 *
 * Items, stock movements, low stock alerts, locations.
 * Assignments connect to teachers/departments.
 *
 * QA-FIX-B — TENANT-SCOPED PERSISTENCE: items + movements survive reload
 * (per-school namespace via createTenantScopedStorage). Search/filter state
 * is ephemeral UI state and is intentionally NOT persisted.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useMemo } from 'react'
import { makeDemoSeedApplier } from '@/lib/store/demo-tenant'
import { migrateLegacyScopedStore, createTenantScopedStorage } from '@/lib/tenant/tenant-storage'
import { DEFAULT_TENANT_ID } from '@/lib/tenant/schools'

migrateLegacyScopedStore('scholario-inventory-v1', DEFAULT_TENANT_ID)

export type ItemCategory = 'Furniture' | 'Stationery' | 'Lab Equipment' | 'Sports' | 'Electronics' | 'Cleaning' | 'IT Equipment'
export type ItemStatus = 'In Stock' | 'Low Stock' | 'Out of Stock'
export type MovementType = 'Stock In' | 'Stock Out' | 'Adjustment' | 'Damaged' | 'Lost' | 'Returned' | 'Issued'
export type StockLocation = 'Store Room A' | 'Store Room B' | 'Science Lab' | 'Computer Lab' | 'Sports Room' | 'Library' | 'Office'

export interface InventoryItem {
  id: string
  name: string
  code: string
  category: ItemCategory
  quantity: number
  unit: string
  unitValue: number
  totalValue: number
  location: StockLocation
  minStock: number
  status: ItemStatus
  description?: string
  assignedTo?: string
  assignedLocation?: string
}

export interface StockMovement {
  id: string
  itemId: string
  itemName: string
  quantity: number
  type: MovementType
  date: string
  user: string
  reason: string
  reference?: string
}

const SEED_ITEMS: InventoryItem[] = [
  { id: 'ITM001', name: 'Notebooks (200 pg)', code: 'STN-NB-200', category: 'Stationery', quantity: 850, unit: 'pcs', unitValue: 45, totalValue: 38250, location: 'Store Room A', minStock: 200, status: 'In Stock' },
  { id: 'ITM002', name: 'Football (Size 5)', code: 'SPT-FB-5', category: 'Sports', quantity: 6, unit: 'pcs', unitValue: 1200, totalValue: 7200, location: 'Sports Room', minStock: 10, status: 'Low Stock' },
  { id: 'ITM003', name: 'Crayons Pack (24)', code: 'STN-CR-24', category: 'Stationery', quantity: 120, unit: 'packs', unitValue: 85, totalValue: 10200, location: 'Store Room A', minStock: 50, status: 'In Stock' },
  { id: 'ITM004', name: 'Whiteboard — 4x6 ft', code: 'FRN-WB-46', category: 'Furniture', quantity: 24, unit: 'pcs', unitValue: 3500, totalValue: 84000, location: 'Store Room B', minStock: 5, status: 'In Stock' },
  { id: 'ITM005', name: 'Beaker Set (Glass)', code: 'LAB-BK-SET', category: 'Lab Equipment', quantity: 4, unit: 'sets', unitValue: 2800, totalValue: 11200, location: 'Science Lab', minStock: 8, status: 'Low Stock' },
  { id: 'ITM006', name: 'Microscope (Compound)', code: 'LAB-MS-COMP', category: 'Lab Equipment', quantity: 12, unit: 'pcs', unitValue: 15000, totalValue: 180000, location: 'Science Lab', minStock: 6, status: 'In Stock' },
  { id: 'ITM007', name: 'Dell Desktop PC', code: 'IT-PC-DELL', category: 'IT Equipment', quantity: 48, unit: 'pcs', unitValue: 35000, totalValue: 1680000, location: 'Computer Lab', minStock: 10, status: 'In Stock' },
  { id: 'ITM008', name: 'Projector (Epson)', code: 'IT-PJ-EP', category: 'Electronics', quantity: 8, unit: 'pcs', unitValue: 45000, totalValue: 360000, location: 'Office', minStock: 3, status: 'In Stock' },
  { id: 'ITM009', name: 'Chairs (Student)', code: 'FRN-CH-ST', category: 'Furniture', quantity: 480, unit: 'pcs', unitValue: 850, totalValue: 408000, location: 'Store Room B', minStock: 50, status: 'In Stock' },
  { id: 'ITM010', name: 'Cleaning Solution (5L)', code: 'CLN-SOL-5L', category: 'Cleaning', quantity: 3, unit: 'bottles', unitValue: 350, totalValue: 1050, location: 'Store Room A', minStock: 10, status: 'Low Stock' },
  { id: 'ITM011', name: 'Basketball', code: 'SPT-BB-PRO', category: 'Sports', quantity: 4, unit: 'pcs', unitValue: 1800, totalValue: 7200, location: 'Sports Room', minStock: 5, status: 'Low Stock' },
  { id: 'ITM012', name: 'Printer (HP LaserJet)', code: 'IT-PR-HP', category: 'IT Equipment', quantity: 6, unit: 'pcs', unitValue: 18000, totalValue: 108000, location: 'Office', minStock: 2, status: 'In Stock' },
  { id: 'ITM013', name: 'Lab Coats', code: 'LAB-LC-STD', category: 'Lab Equipment', quantity: 60, unit: 'pcs', unitValue: 450, totalValue: 27000, location: 'Science Lab', minStock: 30, status: 'In Stock' },
  { id: 'ITM014', name: 'Cricket Kit (Complete)', code: 'SPT-CK-FULL', category: 'Sports', quantity: 0, unit: 'sets', unitValue: 8500, totalValue: 0, location: 'Sports Room', minStock: 3, status: 'Out of Stock' },
  { id: 'ITM015', name: 'Markers (Whiteboard)', code: 'STN-MK-WB', category: 'Stationery', quantity: 240, unit: 'pcs', unitValue: 35, totalValue: 8400, location: 'Store Room A', minStock: 100, status: 'In Stock' },
]

const SEED_MOVEMENTS: StockMovement[] = [
  { id: 'M1', itemId: 'ITM001', itemName: 'Notebooks (200 pg)', quantity: 200, type: 'Stock In', date: '2025-11-28', user: 'Geeta Sharma', reason: 'Quarterly procurement' },
  { id: 'M2', itemId: 'ITM002', itemName: 'Football (Size 5)', quantity: 4, type: 'Issued', date: '2025-11-28', user: 'Sanjay Reddy', reason: 'Sports day practice' },
  { id: 'M3', itemId: 'ITM003', itemName: 'Crayons Pack (24)', quantity: 8, type: 'Issued', date: '2025-11-27', user: 'Faisal Ahmed', reason: 'Art class — Class 3' },
  { id: 'M4', itemId: 'ITM004', itemName: 'Whiteboard — 4x6 ft', quantity: 6, type: 'Stock In', date: '2025-11-27', user: 'Storekeeper', reason: 'New academic year stock' },
  { id: 'M5', itemId: 'ITM005', itemName: 'Beaker Set (Glass)', quantity: 2, type: 'Damaged', date: '2025-11-26', user: 'Kavita Joshi', reason: 'Broken during lab session' },
  { id: 'M6', itemId: 'ITM006', itemName: 'Microscope (Compound)', quantity: 4, type: 'Issued', date: '2025-11-25', user: 'Pooja Bhatt', reason: 'Science lab — Class 10 practical' },
  { id: 'M7', itemId: 'ITM010', itemName: 'Cleaning Solution (5L)', quantity: 5, type: 'Stock Out', date: '2025-11-24', user: 'Ramesh Kumar', reason: 'Daily cleaning supplies' },
  { id: 'M8', itemId: 'ITM011', itemName: 'Basketball', quantity: 2, type: 'Issued', date: '2025-11-23', user: 'Sanjay Reddy', reason: 'Inter-house tournament' },
]

interface InventoryState {
  items: InventoryItem[]
  movements: StockMovement[]
  search: string
  categoryFilter: string
  locationFilter: string
  statusFilter: string
  /** FINAL-GATE (EG-9F/R4) — set once the demo seed has been applied. */
  demoSeeded?: boolean
  /** FINAL-GATE (EG-9F/R4) — one-shot demo-tier seeder (module root). */
  ensureDemoSeed: () => void

  setSearch: (q: string) => void
  setCategoryFilter: (c: string) => void
  setLocationFilter: (l: string) => void
  setStatusFilter: (s: string) => void
  addItem: (item: Omit<InventoryItem, 'id' | 'totalValue' | 'status'>) => void
  addStock: (itemId: string, qty: number, reason: string) => void
  adjustStock: (itemId: string, qty: number, reason: string) => void
  issueItem: (itemId: string, qty: number, assignedTo: string, reason: string) => void
  markDamaged: (itemId: string, qty: number, reason: string) => void
  returnItem: (itemId: string, qty: number, reason: string) => void
}

function calcStatus(qty: number, min: number): ItemStatus {
  if (qty <= 0) return 'Out of Stock'
  if (qty <= min) return 'Low Stock'
  return 'In Stock'
}

export const useInventoryStore = create<InventoryState>()(
  persist(
    (set, get) => ({
  // FINAL-GATE (EG-9F/R4) — the seed corpus above is the sanctioned DEMO
  // TIER content (School.isDemo): the store boots EMPTY and the Inventory
  // module root applies it once per session via `ensureDemoSeed`. A real
  // production tenant keeps the honest empty state; persisted tenant-
  // scoped state always wins over re-seeding.
  items: [],
  movements: [],
  search: '',
  categoryFilter: 'all',
  locationFilter: 'all',
  statusFilter: 'all',
  ensureDemoSeed: () => ensureInventoryDemoSeed(),

  setSearch: (q) => set({ search: q }),
  setCategoryFilter: (c) => set({ categoryFilter: c }),
  setLocationFilter: (l) => set({ locationFilter: l }),
  setStatusFilter: (s) => set({ statusFilter: s }),

  addItem: (item) => {
    const state = get()
    const id = `ITM${String(state.items.length + 1).padStart(3, '0')}${Date.now().toString(36)}`
    const newItem: InventoryItem = {
      ...item,
      id,
      totalValue: item.quantity * item.unitValue,
      status: calcStatus(item.quantity, item.minStock),
    }
    set({ items: [newItem, ...state.items] })
  },

  addStock: (itemId, qty, reason) => {
    const state = get()
    const item = state.items.find((i) => i.id === itemId)
    if (!item) return
    const newQty = item.quantity + qty
    set({
      items: state.items.map((i) => i.id === itemId
        ? { ...i, quantity: newQty, totalValue: newQty * i.unitValue, status: calcStatus(newQty, i.minStock) }
        : i),
      movements: [{
        id: `M${Date.now()}`, itemId, itemName: item.name, quantity: qty,
        type: 'Stock In', date: new Date().toISOString().split('T')[0],
        user: 'Principal', reason,
      }, ...state.movements],
    })
  },

  adjustStock: (itemId, qty, reason) => {
    const state = get()
    const item = state.items.find((i) => i.id === itemId)
    if (!item) return
    const newQty = item.quantity + qty
    set({
      items: state.items.map((i) => i.id === itemId
        ? { ...i, quantity: Math.max(0, newQty), totalValue: Math.max(0, newQty) * i.unitValue, status: calcStatus(Math.max(0, newQty), i.minStock) }
        : i),
      movements: [{
        id: `M${Date.now()}`, itemId, itemName: item.name, quantity: Math.abs(qty),
        type: 'Adjustment', date: new Date().toISOString().split('T')[0],
        user: 'Principal', reason,
      }, ...state.movements],
    })
  },

  issueItem: (itemId, qty, assignedTo, reason) => {
    const state = get()
    const item = state.items.find((i) => i.id === itemId)
    if (!item || item.quantity < qty) return
    const newQty = item.quantity - qty
    set({
      items: state.items.map((i) => i.id === itemId
        ? { ...i, quantity: newQty, totalValue: newQty * i.unitValue, status: calcStatus(newQty, i.minStock), assignedTo, assignedLocation: assignedTo }
        : i),
      movements: [{
        id: `M${Date.now()}`, itemId, itemName: item.name, quantity: qty,
        type: 'Issued', date: new Date().toISOString().split('T')[0],
        user: 'Principal', reason, reference: assignedTo,
      }, ...state.movements],
    })
  },

  markDamaged: (itemId, qty, reason) => {
    const state = get()
    const item = state.items.find((i) => i.id === itemId)
    if (!item || item.quantity < qty) return
    const newQty = item.quantity - qty
    set({
      items: state.items.map((i) => i.id === itemId
        ? { ...i, quantity: newQty, totalValue: newQty * i.unitValue, status: calcStatus(newQty, i.minStock) }
        : i),
      movements: [{
        id: `M${Date.now()}`, itemId, itemName: item.name, quantity: qty,
        type: 'Damaged', date: new Date().toISOString().split('T')[0],
        user: 'Principal', reason,
      }, ...state.movements],
    })
  },

  returnItem: (itemId, qty, reason) => {
    const state = get()
    const item = state.items.find((i) => i.id === itemId)
    if (!item) return
    const newQty = item.quantity + qty
    set({
      items: state.items.map((i) => i.id === itemId
        ? { ...i, quantity: newQty, totalValue: newQty * i.unitValue, status: calcStatus(newQty, i.minStock), assignedTo: undefined, assignedLocation: undefined }
        : i),
      movements: [{
        id: `M${Date.now()}`, itemId, itemName: item.name, quantity: qty,
        type: 'Returned', date: new Date().toISOString().split('T')[0],
        user: 'Principal', reason,
      }, ...state.movements],
    })
  },
    }),
    {
      name: 'scholario-inventory-v1',
      storage: createTenantScopedStorage('scholario-inventory-v1'),
      // v1 → v2 (PIH-4c, stale-persist purge): the FINAL-GATE emptied the
      // initial seed state but the version was NOT bumped then — pre-gate
      // browsers would rehydrate the fabricated item/movement ledger
      // forever. The bump discards stale v1 persisted state once (zustand
      // skips hydration on version mismatch; the demo seeder re-applies
      // the corpus for the demo tenant).
      version: 2,
      // DATA slices only — search/filters are UI state, actions are functions.
      partialize: (s) => ({ items: s.items, movements: s.movements }),
    },
  ),
)

// ─── FINAL-GATE (EG-9F/R4) demo-tier seeder ──────────────────────────
// Built lazily on first call (the store exists by then). Applies the
// sanctioned demo corpus at most once, never over non-pristine state —
// see makeDemoSeedApplier guard rules.
let _ensureInventoryDemoSeed: (() => void) | null = null
function ensureInventoryDemoSeed(): void {
  _ensureInventoryDemoSeed ??= makeDemoSeedApplier(useInventoryStore, {
    items: SEED_ITEMS,
    movements: SEED_MOVEMENTS,
  })
  _ensureInventoryDemoSeed()
}

export function useInventoryData() {
  const items = useInventoryStore((s) => s.items)
  const movements = useInventoryStore((s) => s.movements)

  return useMemo(() => {
    const totalItems = items.length
    const totalValue = items.reduce((s, i) => s + i.totalValue, 0)
    const lowStock = items.filter((i) => i.status === 'Low Stock')
    const outOfStock = items.filter((i) => i.status === 'Out of Stock')
    const categories = new Set(items.map((i) => i.category))

    const valueByCategory = Array.from(categories).map((cat) => ({
      name: cat,
      value: items.filter((i) => i.category === cat).reduce((s, i) => s + i.totalValue, 0),
      color: cat === 'Furniture' ? 'oklch(0.55 0.14 162)' :
             cat === 'Stationery' ? 'oklch(0.65 0.16 75)' :
             cat === 'Lab Equipment' ? 'oklch(0.6 0.18 300)' :
             cat === 'Sports' ? 'oklch(0.7 0.15 200)' :
             cat === 'Electronics' ? 'oklch(0.62 0.2 25)' :
             cat === 'Cleaning' ? 'oklch(0.55 0.16 250)' :
             'oklch(0.7 0.15 60)',
    }))

    return {
      items, movements,
      analytics: {
        totalItems, totalValue,
        lowStockCount: lowStock.length,
        outOfStockCount: outOfStock.length,
        categoryCount: categories.size,
        lowStock, outOfStock,
        valueByCategory,
        recentMovements: movements.slice(0, 8),
      },
    }
  }, [items, movements])
}
