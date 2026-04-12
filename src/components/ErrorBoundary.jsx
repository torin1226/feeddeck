import { Component } from 'react'

// ============================================================
// ErrorBoundary
// Catches React render errors and shows a recovery UI instead
// of a white screen. Logs component stack traces to console.
// Per-section boundaries wrap each route so one crash doesn't
// kill the whole app.
// ============================================================

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error(
      `[ErrorBoundary] ${this.props.name || 'App'} crashed:`,
      error,
      errorInfo?.componentStack
    )

    // Auto-reload on chunk load failure (app was updated)
    if (this.isChunkError(error)) {
      setTimeout(() => window.location.reload(), 1500)
    }
  }

  isChunkError(error) {
    const msg = error?.message || ''
    return error?.name === 'ChunkLoadError' ||
      msg.includes('Loading chunk') ||
      msg.includes('dynamically imported module')
  }

  isNetworkError(error) {
    const msg = error?.message || ''
    return msg.includes('fetch') || msg.includes('network') ||
      msg.includes('NetworkError') || msg.includes('ERR_')
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      const error = this.state.error
      const isChunk = this.isChunkError(error)
      const isNetwork = this.isNetworkError(error)

      // Chunk load failure — app was updated, auto-reloading
      if (isChunk) {
        return (
          <div className="h-screen w-full flex flex-col items-center justify-center bg-surface text-text-primary px-6">
            <div className="max-w-md text-center space-y-4">
              <div className="text-4xl">🔄</div>
              <h2 className="text-xl font-display font-bold">App updated</h2>
              <p className="text-text-secondary text-sm">Refreshing...</p>
            </div>
          </div>
        )
      }

      // Network error — prompt user to check connection
      if (isNetwork) {
        return (
          <div className="h-screen w-full flex flex-col items-center justify-center bg-surface text-text-primary px-6">
            <div className="max-w-md text-center space-y-4">
              <div className="text-4xl">📡</div>
              <h2 className="text-xl font-display font-bold">Connection error</h2>
              <p className="text-text-secondary text-sm">Check your internet connection</p>
              <button
                onClick={this.handleReload}
                className="mt-4 px-4 py-2 bg-primary text-white rounded-md text-sm font-medium"
              >
                Retry
              </button>
            </div>
          </div>
        )
      }

      // Generic error — show error details and recovery options
      return (
        <div className="h-screen w-full flex flex-col items-center justify-center bg-surface text-text-primary px-6">
          <div className="max-w-md text-center space-y-4">
            <div className="text-4xl">⚠️</div>
            <h2 className="text-xl font-display font-bold">Something went wrong</h2>
            <p className="text-text-secondary text-sm">
              {error?.message || 'An unexpected error occurred'}
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 bg-primary text-white rounded-md text-sm font-medium"
              >
                Try again
              </button>
              <button
                onClick={this.handleReload}
                className="px-4 py-2 bg-bg-secondary text-text-primary rounded-md text-sm font-medium"
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary