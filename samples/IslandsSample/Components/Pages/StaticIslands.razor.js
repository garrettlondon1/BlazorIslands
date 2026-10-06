// Page-specific JavaScript. Runs on full loads AND enhanced navigation, which a <script> tag in the page would not.
const state = (globalThis.__pageScript ??= { mounts: 0, unmounts: 0, pageUpdates: 0 });

export function mount(ctx) {
  state.mounts++;
  const render = () => {
    const status = document.getElementById('page-script-status');
    if (status) {
      status.textContent = `Page script mounted (${state.mounts} mount(s), ${state.pageUpdates} page update(s)).`;
    }
  };
  render();
  // Enhanced updates re-render the page from the server and would revert our text; re-apply it.
  ctx.onPageUpdate(() => {
    state.pageUpdates++;
    render();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F2') {
      state.lastKey = 'F2';
    }
  }, { signal: ctx.signal });
}

export function unmount() {
  state.unmounts++;
}
