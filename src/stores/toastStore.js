import { create } from 'zustand'

const useToastStore = create((set) => ({
  toast: null,
  showToast: (message, type = 'info') => set({ toast: { id: Date.now(), message, type } }),
  clearToast: () => set({ toast: null }),
}))

export default useToastStore
