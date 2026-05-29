import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  message: string;
}

/**
 * Catches render-time throws anywhere in the tree and shows a friendly fallback
 * instead of a blank transparent window (which is what a crash looks like in a
 * frameless Tauri window — indistinguishable from "the app died").
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(err: unknown): State {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep a breadcrumb for debugging (visible in the WebView devtools console).
    console.error("[Lumi] render error:", error, info.componentStack);
  }

  private reload = () => {
    this.setState({ hasError: false, message: "" });
    try {
      window.location.reload();
    } catch {
      /* noop */
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="crash-screen">
        <div className="crash-emoji">🌸</div>
        <div className="crash-title">Oops — Lumi tripped over a wire</div>
        <div className="crash-sub">A little glitch happened. A quick reload usually fixes it.</div>
        <button className="crash-btn" onClick={this.reload}>
          Reload Lumi
        </button>
        {this.state.message ? <div className="crash-detail">{this.state.message}</div> : null}
      </div>
    );
  }
}
