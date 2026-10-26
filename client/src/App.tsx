import { APP_NAME } from '@inkling/shared';
import { Sketchpad } from './Sketchpad';
import { useConnection } from './useConnection';

export function App() {
  const { state, latencyMs } = useConnection();

  return (
    <main className="shell">
      <header className="brand">
        <img src="/logo.svg" alt="" />
        <div>
          <h1>{APP_NAME}</h1>
          <p>Draw it. Guess it. Heckle your friends.</p>
        </div>
      </header>

      <section className="card" aria-live="polite">
        <span className="status" data-state={state}>
          Server: {state}
          {latencyMs !== null && ` · ${latencyMs} ms`}
        </span>
        <p>Scaffold is live. Rooms and lobby arrive next; for now, doodle to test the canvas.</p>
        <Sketchpad />
      </section>
    </main>
  );
}
