import { create } from 'zustand'

const usePaletteStore = create((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
  show: () => set({ open: true }),
}))

export default usePaletteStore
