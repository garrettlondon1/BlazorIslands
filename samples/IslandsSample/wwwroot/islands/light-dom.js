// Renders into the host element itself (shadow="none"). Document styles apply, and adoptStyles adds to the document.
export function mount(ctx) {
  ctx.adoptStyles('.light-island { border-left: 4px solid #2da44e; padding-left: .5rem; }');
  const p = document.createElement('p');
  p.className = 'light-island';
  p.setAttribute('data-testid', 'light');
  p.textContent = `${ctx.props.text} (instance ${ctx.id})`;
  ctx.root.append(p);
}
