/** @jsxImportSource react */
// React TSX bundle: React is bundled in (it ships no browser ESM build), each island gets its own React root.
import { useState } from 'react';
import { reactIslands, useIsland } from '@blazor-islands/client/react';
import type { ChartProps, GreetingProps } from './generated/types';

function Greeting({ name, visits }: GreetingProps) {
  const [clicks, setClicks] = useState(0);
  const island = useIsland<GreetingProps>();
  return (
    <div>
      <p data-testid="greeting">Hello {name}, visit #{visits}</p>
      <button type="button" data-testid="greeting-click" onClick={() => { setClicks(clicks + 1); island.emit('clicked', { clicks: clicks + 1 }); }}>
        Clicked {clicks} times
      </button>
    </div>
  );
}

function Chart({ title, points, highlight }: ChartProps) {
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <figure>
      <figcaption data-testid="chart-title">{title}</figcaption>
      <svg width={points.length * 40} height={100} role="img" aria-label={title}>
        {points.map((p, i) => (
          <rect
            key={p.label}
            data-testid="bar"
            data-label={p.label}
            x={i * 40 + 5}
            y={100 - (p.value / max) * 100}
            width={30}
            height={(p.value / max) * 100}
            fill={p.label === highlight ? '#cf222e' : '#0969da'}
          />
        ))}
      </svg>
    </figure>
  );
}

export const islands = reactIslands({ Greeting, Chart });
