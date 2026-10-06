// The matrix probe island. Plain module, no framework, so counts are exact: it renders its props and its own click
// count, and emits 'probe-click' (received by <Island OnEvent> in interactive render modes).
function render(ctx, props) {
  const out = ctx.root.querySelector('output');
  out.textContent = JSON.stringify({ id: ctx.id, clicks: ctx.element.__clicks ?? 0, ...props });
}

export default {
  mount(ctx) {
    const out = document.createElement('output');
    out.setAttribute('data-testid', 'probe');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Island click';
    button.setAttribute('data-testid', 'probe-click');
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks++;
      ctx.element.__clicks = clicks;
      render(ctx, ctx.props);
      ctx.emit('probe-click', { clicks });
    }, { signal: ctx.signal });
    ctx.root.append(out, button);
    // State lives on the instance (closure), not the element: it must survive a handoff to a new element.
    Object.defineProperty(ctx, '__clicks', { get: () => clicks });
    ctx.element.__clicks = clicks;
    render(ctx, ctx.props);
    ctx.onPageUpdate(() => {
      ctx.element.__clicks = clicks;
      render(ctx, ctx.props);
    });
  },
  update(props, ctx) {
    render(ctx, props);
  },
};
