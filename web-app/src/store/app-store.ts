import { create } from 'zustand'

interface Org {
  id: string
  slug: string
  name: string
}

interface Brand {
  id: string
  name: string
}

interface AppState {
  currentOrg: Org | null
  currentBrand: Brand | null
  commandPaletteOpen: boolean
  mobileSidebarOpen: boolean
  setOrg: (org: Org | null) => void
  setBrand: (brand: Brand | null) => void
  toggleCommandPalette: () => void
  openCommandPalette: () => void
  closeCommandPalette: () => void
  toggleMobileSidebar: () => void
  closeMobileSidebar: () => void
}

export const useAppStore = create<AppState>((set) => ({
  currentOrg: null,
  currentBrand: null,
  commandPaletteOpen: false,
  mobileSidebarOpen: false,
  setOrg: (org) => set({ currentOrg: org }),
  setBrand: (brand) => set({ currentBrand: brand }),
  toggleCommandPalette: () =>
    set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  toggleMobileSidebar: () =>
    set((s) => ({ mobileSidebarOpen: !s.mobileSidebarOpen })),
  closeMobileSidebar: () => set({ mobileSidebarOpen: false }),
}))
