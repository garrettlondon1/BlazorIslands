// Runs when the page is shown (full load or enhanced navigation) and cleans up when you leave.
export function mount(ctx) {
  const output = () => document.getElementById('page-script-output');
  const started = new Date().toLocaleTimeString();
  const render = () => {
    output().textContent = `Page script mounted at ${started}. Press any key.`;
  };
  render();

  // Blazor may re-render the page around the script (enhanced form posts, streaming): re-apply what it wrote.
  ctx.onPageUpdate(render);

  // Removed automatically when the user navigates away.
  document.addEventListener('keydown', (e) => {
    output().textContent = `You pressed "${e.key}".`;
  }, { signal: ctx.signal });
}
