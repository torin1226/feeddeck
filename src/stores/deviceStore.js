import { create } from 'zustand'

// ============================================================
// deviceStore
// Toggles mobile preview mode on desktop. Wraps the app in a
// phone-sized frame for testing mobile layouts.
// ============================================================

const useDeviceStore = create((set) => ({
  mobilePreview: false,
  toggleMobilePreview: () => set(s => ({ mobilePreview: !s.mobilePreview })),
}))

export default useDeviceStore
