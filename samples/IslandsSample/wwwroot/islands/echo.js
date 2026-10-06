// Shows its props and its instance id, so tests can tell an in-place update from a remount.
function render(ctx, props) {
  let out = ctx.root.querySelector('[data-testid="echo"]');
  if (!out) {
    out = document.createElement('pre');
    out.setAttribute('data-testid', 'echo');
    ctx.root.append(out);
  }
  out.textContent = JSON.stringify({ id: ctx.id, n: props?.n ?? null, source: props?.source ?? null, updates: ctx.element.__updates ?? 0 });
}

export default {
  mount(ctx) {
    ctx.element.__updates = 0;
    render(ctx, ctx.props);
  },
  update(props, ctx) {
    ctx.element.__updates = (ctx.element.__updates ?? 0) + 1;
    render(ctx, props);
  },
};
