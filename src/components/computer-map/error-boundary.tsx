import { Component, type ReactNode } from 'react';

/** Both React roots use this boundary; the native list survives scene/import failures. */
export class MapErrorBoundary extends Component<
  { children: ReactNode; onError: (error?: unknown) => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
