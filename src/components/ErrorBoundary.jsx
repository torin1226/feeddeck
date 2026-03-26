import { Component } from 'react'

// ============================================================
// ErrorBoundary
// Catches React render errors and shows a recovery UI instead
// of a white screen. Logs component stack traces to console.
// Per-section boundaries wrap each route so one crash doesn't
// kill the whole app.
// ============================================================

export class ErrorBoundary extends Component {
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
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-full flex flex-col items-center justify-center bg-surface text-text-primary px-6">
          <div className="max-w-md text-center space-y-4">
            <div className="text-4xl">⚠</div>
            <h2 className="text-xl font-display font-bold">Something went wrong</h2>
            <p className="text-text-secondary text-sm">
              {this.props.name
                ? `The ${this.props.name} section crashed.`
                : 'An unexpected error occurred.'}
            </p>
            {this.state.error?.message && (
              <pre className="text-xs text-text-muted bg-surface-overlay rounded-lg p-3 mt-2 text-left overflow-auto max-h-32">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-3 justify-center pt-2">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 rounded-lg bg-surface-overlay border border-surface-border
                  text-text-secondary hover:text-text-primary transition-colors text-sm
                  active:scale-95"
              >
                Try Again
              </button>
              <button
                onClick={this.handleReload}
                className="px-4 py-2 rounded-lg bg-accent text-white font-medium text-sm
                  hover:bg-accent/90 transition-colors active:scale-95"
              >
                Reload Page
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
