// Licensed under the MIT license.
//
// Blazor JS initializer, discovered and imported by blazor.web.js because of its name (BlazorIslands.lib.module.js).
// Deliberately independent of the island runtime: it only bridges Blazor events into DOM events, so islands never
// wait for Blazor and Blazor never waits for islands. It is trusted under the CSP because it is same-origin ('self'),
// and under 'strict-dynamic' because blazor.web.js (which carries the nonce) imports it.

interface ReconnectionHandlerLike {
  onConnectionDown(...args: unknown[]): void;
  onConnectionUp(): void;
}

interface BlazorLike {
  addEventListener(name: 'enhancedload', callback: () => void): void;
  registerCustomEventType?(name: string, options: { browserEventName: string; createEventArgs: (e: Event) => unknown }): void;
  defaultReconnectionHandler?: ReconnectionHandlerLike;
}

interface StartOptions {
  circuit?: {
    circuitHandlers?: Array<{ onCircuitOpened?: () => void; onCircuitClosed?: () => void }>;
  };
}

const registeredKey = Symbol.for('blazor-islands.custom-event-registered');
const reconnectKey = Symbol.for('blazor-islands.reconnect-wrapped');

function signal(type: string): void {
  document.dispatchEvent(new CustomEvent('blazor-islands:blazor', { detail: { type } }));
}

function blazor(): BlazorLike | undefined {
  return (globalThis as { Blazor?: BlazorLike }).Blazor;
}

function registerEvents(b: BlazorLike): void {
  const g = globalThis as { [registeredKey]?: boolean };
  if (g[registeredKey] || !b.registerCustomEventType) {
    return;
  }
  g[registeredKey] = true;
  // Razor: <Island OnEvent="..."> renders @onislandevent; ctx.emit dispatches 'blazor-island-event'.
  b.registerCustomEventType('islandevent', {
    browserEventName: 'blazor-island-event',
    createEventArgs: (e) => {
      const detail = (e as CustomEvent<{ name: string; detail: unknown }>).detail;
      return { name: detail?.name ?? '', detail: detail?.detail ?? null };
    },
  });
}

/** Records circuit open/close through Blazor's circuit handler hook. */
function observeCircuits(options: StartOptions | undefined): void {
  const circuit = options?.circuit;
  if (circuit) {
    circuit.circuitHandlers ??= [];
    circuit.circuitHandlers.push({
      onCircuitOpened: () => signal('circuit-opened'),
      onCircuitClosed: () => signal('circuit-closed'),
    });
  }
}

/**
 * Records connection drops and recoveries. Blazor creates its default reconnection handler only after initializers
 * run, so it is wrapped once the circuit has started rather than replaced up front.
 */
function observeReconnection(): void {
  const handler = blazor()?.defaultReconnectionHandler as (ReconnectionHandlerLike & { [reconnectKey]?: boolean }) | undefined;
  if (!handler || handler[reconnectKey]) {
    return;
  }
  handler[reconnectKey] = true;
  const down = handler.onConnectionDown.bind(handler);
  const up = handler.onConnectionUp.bind(handler);
  handler.onConnectionDown = (...args: unknown[]) => {
    signal('circuit-down');
    down(...args);
  };
  handler.onConnectionUp = () => {
    signal('circuit-up');
    up();
  };
}

export function beforeWebStart(options: StartOptions): void {
  observeCircuits(options);
  // Custom event types must exist before interactive components render their first batch.
  const b = blazor();
  if (b) {
    registerEvents(b);
  }
}

export function afterWebStarted(b: BlazorLike): void {
  registerEvents(b);
  signal('web-started');
  b.addEventListener('enhancedload', () => {
    signal('enhanced-load');
    document.dispatchEvent(new CustomEvent('blazor-islands:page-update'));
  });
}

export function afterServerStarted(): void {
  signal('server-started');
  observeReconnection();
}

export function afterWebAssemblyStarted(): void {
  signal('webassembly-started');
}

// Standalone Blazor Server / WebAssembly (no blazor.web.js) use the classic initializer names.
export function beforeStart(options: StartOptions): void {
  beforeWebStart(options);
}

export function afterStarted(b: BlazorLike): void {
  registerEvents(b);
  signal('web-started');
  observeReconnection();
}
