// A plain-module island: no framework, just mount/unmount. Everything registered on ctx.signal or ctx.onDispose is
// cleaned up when the island leaves the page, whichever way it leaves.
export function mount(ctx) {
  const time = document.createElement('time');
  time.setAttribute('data-testid', 'time');
  ctx.root.append(time);

  const tick = () => {
    time.textContent = `${ctx.props?.zone ?? 'local'} ${new Date().toISOString()}`;
  };
  tick();
  const timer = setInterval(tick, 250);
  ctx.onDispose(() => clearInterval(timer));

  const stats = (globalThis.__clock ??= { mounts: 0, unmounts: 0, ticksAfterUnmount: 0 });
  stats.mounts++;
  ctx.onDispose(() => {
    stats.unmounts++;
    // Proves the interval is really gone: nothing may tick after this point.
    const before = time.textContent;
    setTimeout(() => {
      if (time.textContent !== before) {
        stats.ticksAfterUnmount++;
      }
    }, 600);
  });

  window.addEventListener('resize', tick, { signal: ctx.signal });
}
