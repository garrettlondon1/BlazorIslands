// The JS half of ProbeWidget.razor: one instance per component.
const stats = (globalThis.__widget ??= { constructed: 0, unmounted: 0, updates: 0, renders: 0 });

export default class ProbeWidget {
  clicks = 0;

  constructor(ctx) {
    stats.constructed++;
    this.ctx = ctx;
    // Delegated and handoff-safe: works no matter how often Blazor re-renders or replaces the button.
    ctx.on('click', '[data-ref="js-click"]', () => this.onClick());
    this.paint();
  }

  async onClick() {
    this.clicks++;
    this.paint();
    if (this.ctx.interactive) {
      await this.ctx.invokeDotNet('JsClicked', this.clicks);
    }
  }

  // C# parameters changed (interactive re-render, enhanced navigation, streaming).
  update(params) {
    stats.updates++;
    this.paint();
  }

  // Blazor changed the markup: re-apply what JS owns inside it.
  rendered() {
    stats.renders++;
    this.paint();
  }

  // Called from C#: InvokeJSAsync<string>("describe", "from .NET").
  describe(arg) {
    return `${arg}: instance ${this.ctx.id}, label ${this.ctx.props.label}, count ${this.ctx.props.count}, clicks ${this.clicks}`;
  }

  // Called from C# with an ElementReference, which arrives as the element.
  flash(element) {
    return `flashed ${element.tagName.toLowerCase()}#${element.id} value=${element.value}`;
  }

  paint() {
    const out = this.ctx.ref('js-count');
    if (out && out.textContent !== String(this.clicks)) {
      out.textContent = String(this.clicks);
    }
  }

  unmount() {
    stats.unmounted++;
  }
}
