// Preact + htm island. No build step: 'htm/preact', 'preact/hooks' and the adapter resolve through the import map
// that <IslandsHead /> renders, so this file is served exactly as written.
import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { preactIsland, useIsland } from '@blazor-islands/client/preact';

/** @param {import('../../islands-src/generated/types').CounterProps} props */
function Counter({ start, label, note }) {
  const [count, setCount] = useState(start);
  const island = useIsland();

  // New props from the server (navigation, streaming, interactive render) reset the count.
  useEffect(() => setCount(start), [start]);

  const increment = () => {
    const next = count + 1;
    setCount(next);
    island.emit('incremented', { count: next });
  };

  return html`
    <div class="counter">
      <span class="label">${label}</span>
      <output data-testid="count">${count}</output>
      <button type="button" data-testid="increment" onClick=${increment}>+1</button>
      ${note ? html`<small data-testid="note">${note}</small>` : null}
    </div>`;
}

export default preactIsland(Counter, {
  styles: [`
    .counter { display: inline-flex; gap: .5rem; align-items: center; padding: .5rem .75rem; border: 1px solid #d0d7de; border-radius: 6px; }
    output { font-weight: 600; min-width: 2ch; text-align: right; }
    button { cursor: pointer; }
  `],
});
