'use client'

// Uniforms tab — uniform apparel items plus the "Add Uniform Item"
// dialog. Owns its local newUniform state and wires the create handler to
// store.addUniformItem.
//
// PHASE 7.5: edits still work through the client store; an explicit
// "Save to School Record" persists the catalogue to the server settings
// JSON (PATCH { settings: { uniforms: [...] } }) so it survives browsers.

import { useEffect, useMemo, useState } from 'react'
import { Shirt, Plus, Save } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  useSchoolSettingsStore,
  applySchoolConfig,
} from '@/lib/store/school-settings-store'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { patchSettingsSlice } from './server-api'
import { SettingsTab, SyncChip } from './shared'

const DEFAULT_UNIFORM = {
  name: '',
  category: 'Summer' as const,
  price: 500,
  sizes: 'S, M, L, XL',
  stock: 100,
}

export function UniformsTab() {
  const store = useSchoolSettingsStore()
  const [addUniformOpen, setAddUniformOpen] = useState(false)
  const [newUniform, setNewUniform] = useState({ ...DEFAULT_UNIFORM })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Dirty = local catalogue differs from the server-persisted slice.
  const serverUniforms = useSchoolSettingsStore((s) => s.server.settings.uniforms)
  useEffect(() => { setError(null) }, [serverUniforms])
  const dirty = useMemo(
    () => JSON.stringify(store.uniforms) !== JSON.stringify(serverUniforms ?? store.uniforms),
    [store.uniforms, serverUniforms],
  )

  const handleSaveToServer = async () => {
    setSaving(true)
    setError(null)
    const result = await patchSettingsSlice('uniforms', store.uniforms)
    setSaving(false)
    if (result.ok && result.config) {
      applySchoolConfig(result.config)
      toast.success('Uniform catalogue saved to the school record')
    } else {
      setError(result.error)
      toast.error(result.error ?? 'The uniform catalogue could not be saved.')
    }
  }

  const handleCreateUniform = () => {
    if (!newUniform.name.trim()) {
      toast.error('Please enter uniform item name.')
      return
    }
    store.addUniformItem({
      name: newUniform.name,
      category: newUniform.category,
      price: Number(newUniform.price) || 0,
      sizes: newUniform.sizes.split(',').map((s) => s.trim()),
      stock: Number(newUniform.stock) || 0,
    })
    toast.success(`Uniform item "${newUniform.name}" added!`)
    setAddUniformOpen(false)
    setNewUniform({ ...DEFAULT_UNIFORM })
  }

  return (
    <>
      <SettingsTab
        icon={Shirt}
        title="Uniform Items & Pricing"
        description="School uniform apparel items, inventory, and sizes."
        action={
          <Button size="sm" onClick={() => setAddUniformOpen(true)} className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold">
            <Plus className="h-3.5 w-3.5" /> Add Uniform Item
          </Button>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {store.uniforms.map((un) => (
            <div key={un.id} className="p-3.5 rounded-xl border border-border bg-card space-y-2 shadow-2xs">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-[9px]">{un.category}</Badge>
                <span className="font-bold text-emerald-700 dark:text-emerald-400">₹{un.price}</span>
              </div>
              <p className="font-bold text-xs text-foreground">{un.name}</p>
              <p className="text-[10px] text-muted-foreground">Sizes: {un.sizes.join(', ')}</p>
              <p className="text-[10px] text-muted-foreground">Stock: <strong>{un.stock} pcs</strong></p>
            </div>
          ))}
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2.5 text-[11px] text-rose-700 dark:text-rose-300"
          >
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <SyncChip dirty={dirty} saving={saving} />
          <Button
            size="sm"
            disabled={saving || !dirty}
            onClick={handleSaveToServer}
            className={cn('gap-1.5 text-xs font-bold', 'bg-emerald-600 hover:bg-emerald-700 text-white')}
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving…' : 'Save to School Record'}
          </Button>
        </div>
      </SettingsTab>

      {/* DIALOG: ADD UNIFORM ITEM */}
      <Dialog open={addUniformOpen} onOpenChange={setAddUniformOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Shirt className="h-5 w-5 text-emerald-600" /> Add Uniform Item
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div>
              <Label className="text-xs font-semibold mb-1 block">Item Name</Label>
              <Input
                value={newUniform.name}
                onChange={(e) => setNewUniform({ ...newUniform, name: e.target.value })}
                placeholder="Summer Blazer / House Polo"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs font-semibold mb-1 block">Category</Label>
                <Select
                  value={newUniform.category}
                  onValueChange={(val: any) => setNewUniform({ ...newUniform, category: val })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Summer">Summer</SelectItem>
                    <SelectItem value="Winter">Winter</SelectItem>
                    <SelectItem value="Sports">Sports</SelectItem>
                    <SelectItem value="Formal">Formal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1 block">Price (₹)</Label>
                <Input
                  type="number"
                  value={newUniform.price}
                  onChange={(e) => setNewUniform({ ...newUniform, price: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddUniformOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateUniform} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
              Save Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
