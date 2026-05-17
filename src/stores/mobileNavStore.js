import { create } from 'zustand'

// ============================================================
// mobileNavStore
// Controls the mobile hamburger nav sheet open/close state.
// Auto-closes on route change (subscribed in MobileNavSheet).
// ============================================================

const useMobileNavStore = create((set) => ({
  open: false,
  openNav:  () => set({ open: true }),
  closeNav: () => set({ open: false }),
  toggleNav: () => set((s) => ({ open: !s.open })),
}))

export default useMobileNavStore
