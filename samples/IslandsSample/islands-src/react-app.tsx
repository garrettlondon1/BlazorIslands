/** @jsxImportSource react */
// A React "app" spread across islands: ONE root, each island's component portalled into its element. The cart provider
// sits above the portals, so islands share it and it survives enhanced navigation between pages.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createReactIslandApp, useIsland } from '@blazor-islands/client/react';
import { islandJson, IslandHttpError } from '@blazor-islands/client';
import type { CreateNoteRequest, Note } from './generated/types';

interface Cart {
  items: string[];
  add(item: string): void;
}

const CartContext = createContext<Cart | null>(null);

function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<string[]>([]);
  return <CartContext.Provider value={{ items, add: (item) => setItems((x) => [...x, item]) }}>{children}</CartContext.Provider>;
}

function useCart(): Cart {
  const cart = useContext(CartContext);
  if (!cart) {
    throw new Error('No cart');
  }
  return cart;
}

function CartButton({ product }: { product: string }) {
  const cart = useCart();
  return (
    <button type="button" data-testid="add-to-cart" onClick={() => cart.add(product)}>
      Add {product}
    </button>
  );
}

function CartSummary() {
  const cart = useCart();
  return <p data-testid="cart-count">Cart: {cart.items.length} item(s)</p>;
}

type NotesState =
  | { kind: 'loading' }
  | { kind: 'unauthorized' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; notes: Note[] };

function NotesPanel() {
  const island = useIsland();
  const [state, setState] = useState<NotesState>({ kind: 'loading' });
  const [text, setText] = useState('');

  useEffect(() => {
    islandJson<Note[]>('api/notes', { signal: island.signal })
      .then((notes) => setState({ kind: 'ready', notes }))
      .catch((e) => {
        if (island.signal.aborted) {
          return;
        }
        if (e instanceof IslandHttpError && e.response.status === 401) {
          setState({ kind: 'unauthorized' });
        } else {
          setState({ kind: 'error', message: String(e) });
        }
      });
  }, [island]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: CreateNoteRequest = { text, kind: 'Info' };
    try {
      const note = await islandJson<Note>('api/notes', { method: 'POST', body, signal: island.signal });
      setState((s) => (s.kind === 'ready' ? { kind: 'ready', notes: [...s.notes, note] } : s));
      setText('');
    } catch (err) {
      setState({ kind: 'error', message: err instanceof IslandHttpError ? `${err.response.status}` : String(err) });
    }
  };

  switch (state.kind) {
    case 'loading':
      return <p data-testid="notes-status">Loading notes…</p>;
    case 'unauthorized':
      return <p data-testid="notes-status">Sign in to see your notes (the API answered 401).</p>;
    case 'error':
      return <p data-testid="notes-status">Error: {state.message}</p>;
    case 'ready':
      return (
        <div>
          <p data-testid="notes-status">{state.notes.length} note(s)</p>
          <ul data-testid="notes">
            {state.notes.map((n) => <li key={n.id}>{n.text} ({n.kind}, by {n.author})</li>)}
          </ul>
          <form onSubmit={add}>
            <input data-testid="note-input" value={text} onChange={(e) => setText(e.target.value)} aria-label="Note" />
            <button type="submit" data-testid="note-add">Add note</button>
          </form>
        </div>
      );
  }
}

const app = createReactIslandApp({
  components: { CartButton, CartSummary, NotesPanel },
  wrapper: CartProvider,
});

export const islands = app.islands;
