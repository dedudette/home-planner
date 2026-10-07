import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RecoveryScreen } from '../features/recovery/Recovery';
import { defaultRepo } from '../state/store';

interface Props { children: ReactNode; scope: 'app' | 'page'; resetKey?: string }
interface State { error: Error | null; key?: string }

/**
 * `scope="app"` wraps everything, including the provider, and shows the full recovery screen.
 * `scope="page"` wraps one screen, so a problem on Plan does not take the navigation down with it.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Moving to another screen gives it a fresh chance.
    if (props.scope === 'page' && state.key !== props.resetKey) return { key: props.resetKey, error: null };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('CleanFlow crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.scope === 'app') return <RecoveryScreen mode="crash" repo={defaultRepo} />;
    return (
      <div className="card warn stack" role="alert">
        <h2>This screen hit a problem</h2>
        <p className="small">The rest of CleanFlow still works and your data is safe.</p>
        <div className="row wrap">
          <button className="btn secondary" onClick={() => this.setState({ error: null })}>Try again</button>
          <a className="btn secondary" href="#/today">Go to Today</a>
          <a className="btn secondary" href="#/settings">Open Settings</a>
        </div>
      </div>
    );
  }
}
