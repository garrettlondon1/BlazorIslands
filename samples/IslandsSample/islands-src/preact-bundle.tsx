// Preact TSX bundle. Preact, its JSX runtime and signals are NOT bundled: they resolve through the import map to the
// same vendored copies the htm islands use, so state in a signal is shared across every Preact island on the page.
import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { preactIslands, useIsland } from '@blazor-islands/client/preact';
import type { TodoProps } from './generated/types';

const sharedClicks = signal(0);

function TodoList({ title, items }: TodoProps) {
  const [list, setList] = useState(items);
  const [text, setText] = useState('');
  const island = useIsland<TodoProps>();

  const add = (e: Event) => {
    e.preventDefault();
    if (!text.trim()) {
      return;
    }
    setList([...list, text.trim()]);
    setText('');
    island.emit('todo-added', { text });
  };

  return (
    <section>
      <h3 data-testid="todo-title">{title}</h3>
      <ul data-testid="todo-items">
        {list.map((item) => <li key={item}>{item}</li>)}
      </ul>
      <form onSubmit={add}>
        <input data-testid="todo-input" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} aria-label="New item" />
        <button type="submit" data-testid="todo-add">Add</button>
      </form>
    </section>
  );
}

function SignalCounter({ label }: { label: string }) {
  return (
    <button type="button" data-testid="signal" onClick={() => sharedClicks.value++}>
      {label}: {sharedClicks}
    </button>
  );
}

export const islands = preactIslands({ TodoList, SignalCounter });
