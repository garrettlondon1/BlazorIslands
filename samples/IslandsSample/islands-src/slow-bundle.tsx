// Served behind an artificial delay by the sample's dev hook (any /islands/slow* request).
import { preactIslands } from '@blazor-islands/client/preact';

function Hello({ name }: { name: string }) {
  return <p data-testid="slow-hello">Hello from the {name}!</p>;
}

export const islands = preactIslands({ Hello });
