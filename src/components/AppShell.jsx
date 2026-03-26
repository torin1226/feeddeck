import { lazy, Suspense } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import useKeyboard from '../hooks/useKeyboard'
import useQueueSync from '../hooks/useQueueSync'
import useDeviceStore from '../stores/deviceStore'
import ErrorBoundary from './ErrorBoundary'
import FloatingQueue from './FloatingQueue'
import OfflineBanner from './OfflineBanner'

// Code-split route-level pages for smaller initial bundle
const HomePage = lazy(() => import('../pages/HomePage'))
const LibraryPage = lazy(() => import('../pages/LibraryPage'))
const FeedPage = lazy(() => import('../pages/FeedPage'))
const SettingsPage = lazy(() => import('../pages/SettingsPage'))

// ============================================================
// AppShell
// Root layout with routing + shared elements (FloatingQueue,
// global keyboard shortcuts). Supports mobile preview mode
// (Ctrl+M) that wraps the app in a phone-sized frame.
// ============================================================

export default function AppShell() {
  useKeyboard()
  useQueueSync()
  const location = useLocation()
  const isFeed = location.pathname === '/feed'
  const mobilePreview = useDeviceStore(s => s.mobilePreview)
  const toggleMobilePreview = useDeviceStore(s => s.toggleMobilePreview)

  const content = (
    <>
      {/* Skip navigation link for keyboard users */}
      <a href="#main-content" className="skip-nav">Skip to main content</a>

      <main id="main-content">
        <Suspense fallback={
          <div className="h-screen w-full flex items-center justify-center bg-surface">
            <div className="w-8 h-8 border-2 border-text-muted border-t-text-primary rounded-full animate-spin" />
          </div>
        }>
          <Routes>
            <Route path="/" element={<ErrorBoundary name="Homepage"><HomePage /></ErrorBoundary>} />
            <Route path="/library" element={<ErrorBoundary name="Library"><LibraryPage /></ErrorBoundary>} />
            <Route path="/feed" element={<ErrorBoundary name="Feed"><FeedPage /></ErrorBoundary>} />
            <Route path="/settings" element={<ErrorBoundary name="Settings"><SettingsPage /></ErrorBoundary>} />
          </Routes>
        </Suspense>
      </main>

      {/* Global overlays — hide FloatingQueue on feed (immersive) */}
      {!isFeed && <FloatingQueue />}
      <OfflineBanner />
    </>
  )

  return (
    <>
      {mobilePreview ? (
        <div className="h-screen w-screen bg-[#111] flex items-center justify-center">
          {/* Phone frame */}
          <div className="relative rounded-[2.5rem] border-[4px] border-[#333] shadow-2xl shadow-black/60 overflow-hidden"
            style={{ width: 390, height: 844 }}>
            {/* Notch */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[120px] h-[28px] bg-black rounded-b-2xl z-[9999]" />
            {/* App content — mobile-frame class overrides h-dvh to use frame height */}
            <div className="mobile-frame w-full h-full overflow-hidden" style={{ position: 'relative' }}>
              {content}
            </div>
          </div>
          {/* Device label */}
          <div className="absolute bottom-6 text-white/30 text-xs font-mono">
            iPhone 14 Pro — 390 x 844 &middot; Ctrl+M to exit
          </div>
        </div>
      ) : (
        content
      )}

      {/* Mobile preview toggle button — dev only to avoid conflict with FloatingQueue */}
      {import.meta.env.DEV && <button
        onClick={toggleMobilePreview}
        title="Toggle mobile preview (Ctrl+M)"
        aria-label="Toggle mobile preview"
        className={`fixed z-[9999] bottom-4 right-4 w-10 h-10 rounded-full flex items-center justify-center
          cursor-pointer transition-all shadow-lg
          ${mobilePreview
            ? 'bg-accent text-black hover:bg-accent/80'
            : 'bg-surface-overlay border border-surface-border text-text-secondary hover:text-text-primary hover:border-text-muted'
          }`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="7" y="2" width="10" height="20" rx="2" />
          <line x1="12" y1="18" x2="12" y2="18.01" strokeWidth="3" />
        </svg>
      </button>}
    </>
  )
}
