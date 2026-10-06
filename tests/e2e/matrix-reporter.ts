import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Collects every matrix test (projects named `matrix-*`) into one table: rows are "kind · arrival", columns are app
 * modes/browsers. Written to tests/e2e/matrix-report.md and summarized on the console, so "does X work with Y" is one
 * lookup.
 */
export default class MatrixReporter implements Reporter {
  private readonly cells = new Map<string, Map<string, { status: string; error?: string; note?: string }>>();
  private readonly columns = new Set<string>();

  onTestEnd(test: TestCase, result: TestResult) {
    const project = test.parent.project()?.name ?? '';
    if (!project.startsWith('matrix-') || result.status === 'skipped') {
      return;
    }
    // Retries overwrite earlier attempts; the final attempt decides the cell.
    const column = project.slice('matrix-'.length);
    this.columns.add(column);
    const row = this.cells.get(test.title) ?? new Map();
    const note = test.annotations.find((a) => a.type === 'framework-race')?.description;
    row.set(column, { status: result.status, error: result.error?.message?.split('\n')[0], note });
    this.cells.set(test.title, row);
  }

  onEnd(result: FullResult) {
    if (this.cells.size === 0) {
      return;
    }
    const columns = [...this.columns].sort();
    const icon = (s?: string) => (s === 'passed' ? '✅' : s === 'failed' || s === 'timedOut' || s === 'interrupted' ? '❌' : s ? '⚠️' : '·');
    const rows = [...this.cells.keys()].sort();
    const lines = [
      '# BlazorIslands compatibility matrix',
      '',
      `Generated ${new Date().toISOString()} · overall: ${result.status}`,
      '',
      'Each cell asserts: island mounted exactly once (handed over, not re-mounted, when an interactive renderer re-renders',
      'prerendered DOM), props from the final renderer, page script ran exactly once with its DOM changes visible,',
      'island ↔ .NET events and props, .NET → JS interop, teardown on leave, `BlazorIslands.inspect()` clean, zero CSP',
      'violations and zero uncaught errors.',
      '',
      `| page · arrival | ${columns.join(' | ')} |`,
      `| --- | ${columns.map(() => ':---:').join(' | ')} |`,
      ...rows.map((r) => `| ${r} | ${columns.map((c) => {
        const cell = this.cells.get(r)!.get(c);
        return cell?.status === 'passed' && cell.note ? '⚠️' : icon(cell?.status);
      }).join(' | ')} |`),
    ];

    const notes = rows.flatMap((r) => columns
      .filter((c) => this.cells.get(r)!.get(c)?.note)
      .map((c) => `- **${r}** in \`${c}\`: ${this.cells.get(r)!.get(c)!.note}`));
    if (notes.length) {
      lines.push('', '## Framework observations (islands correct, Blazor behaved unexpectedly)', '', ...notes);
    }

    const failures = rows.flatMap((r) =>
      columns
        .filter((c) => !['passed', undefined].includes(this.cells.get(r)!.get(c)?.status))
        .map((c) => `- **${r}** in \`${c}\`: ${this.cells.get(r)!.get(c)!.error ?? this.cells.get(r)!.get(c)!.status}`));
    if (failures.length) {
      lines.push('', '## Failures', '', ...failures);
    }

    const out = resolve(import.meta.dirname, 'matrix-report.md');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, lines.join('\n') + '\n');

    const total = rows.length * columns.length;
    const passed = rows.reduce((n, r) => n + columns.filter((c) => this.cells.get(r)!.get(c)?.status === 'passed').length, 0);
    const ran = rows.reduce((n, r) => n + columns.filter((c) => this.cells.get(r)!.get(c)).length, 0);
    console.log(`\nMatrix: ${passed}/${ran} combinations passed (${total - ran} not applicable) → ${out}`);
  }
}
