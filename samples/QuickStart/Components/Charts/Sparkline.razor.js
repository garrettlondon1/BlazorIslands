// One instance per <Sparkline>. The constructor runs once, even when an interactive render mode takes over a
// prerendered page or the user navigates with enhanced navigation.
export default class Sparkline {
  highlighted = -1;

  constructor(ctx) {
    this.ctx = ctx;
    // Delegated listener: keeps working however often Blazor re-renders the markup.
    ctx.on('click', 'canvas', (e) => this.onClick(e));
    this.draw();
  }

  // Parameters changed in C#.
  update() {
    this.draw();
  }

  // Called from C# with InvokeJSVoidAsync("highlight", index).
  highlight(index) {
    this.highlighted = index;
    this.draw();
  }

  onClick(e) {
    const values = this.ctx.props.values;
    const canvas = e.target;
    const index = Math.round(((e.offsetX / canvas.clientWidth) * (values.length - 1)));
    this.highlight(index);
    if (this.ctx.interactive) {
      this.ctx.invokeDotNet('PointClicked', index, values[index]);
    }
  }

  draw() {
    const canvas = this.ctx.ref('canvas');
    const values = this.ctx.props.values ?? [];
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (values.length < 2) {
      return;
    }
    const max = Math.max(...values);
    const min = Math.min(...values);
    const x = (i) => (i / (values.length - 1)) * (canvas.width - 8) + 4;
    const y = (v) => canvas.height - 4 - ((v - min) / (max - min || 1)) * (canvas.height - 8);
    g.strokeStyle = '#0969da';
    g.lineWidth = 2;
    g.beginPath();
    values.forEach((v, i) => (i === 0 ? g.moveTo(x(i), y(v)) : g.lineTo(x(i), y(v))));
    g.stroke();
    if (this.highlighted >= 0 && this.highlighted < values.length) {
      g.fillStyle = '#cf222e';
      g.beginPath();
      g.arc(x(this.highlighted), y(values[this.highlighted]), 5, 0, Math.PI * 2);
      g.fill();
    }
  }
}
