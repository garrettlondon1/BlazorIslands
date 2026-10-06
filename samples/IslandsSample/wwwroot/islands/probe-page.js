// The matrix page script: the "write normal page JavaScript" case. It touches the page DOM, sets a window global that
// .NET calls through IJSRuntime, listens on document, and must run exactly once per page visit in every render mode and
// navigation style, re-applying its DOM changes whenever Blazor rewrites the page around it.
const state = (globalThis.__probePage ??= {
  mounts: 0,
  unmounts: 0,
  pageUpdates: 0,
  clicks: 0,
  path: null,
  describe() {
    return JSON.stringify({ mounts: this.mounts, unmounts: this.unmounts, pageUpdates: this.pageUpdates, path: this.path });
  },
});

export function mount(ctx) {
  state.mounts++;
  state.path = location.pathname;
  const apply = () => {
    const target = document.getElementById('probe-js');
    if (target) {
      target.textContent = `Page script ran: mount ${state.mounts}, path ${state.path}`;
    }
  };
  apply();
  ctx.onPageUpdate(() => {
    state.pageUpdates++;
    apply();
  });
  document.addEventListener('probe-ping', () => state.clicks++, { signal: ctx.signal });
}

export function unmount() {
  state.unmounts++;
}
