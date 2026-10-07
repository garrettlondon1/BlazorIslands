// A Preact + htm island. No build step: 'htm/preact', 'preact/hooks' and the adapter come from the import map that
// <IslandsHead /> renders.
import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { preactIsland } from '@blazor-islands/client/preact';

function Counter({ start, label }) {
  const [count, setCount] = useState(start);
  return html`
    <p>${label}: <strong>${count}</strong></p>
    <button type="button" onClick=${() => setCount(count + 1)}>+1</button>`;
}

export default preactIsland(Counter);
