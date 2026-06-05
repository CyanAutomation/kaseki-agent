/**
 * Checklist Renderer
 *
 * Renders visual startup checklists as text or markdown
 * Shows progress, completion status, and failure details
 */

export interface ChecklistItem {
  id: string;
  label: string;
}

type ItemState = 'pending' | 'in-progress' | 'complete' | 'failed';

interface ItemWithState extends ChecklistItem {
  state: ItemState;
  error?: string;
}

/**
 * Renders a checklist with progress tracking
 */
export class ChecklistRenderer {
  private title: string;
  private items: ItemWithState[];

  constructor(title: string, items: ChecklistItem[]) {
    this.title = title;
    this.items = items.map(item => ({
      ...item,
      state: 'pending',
    }));
  }

  /**
   * Get total number of items
   */
  getTotalItems(): number {
    return this.items.length;
  }

  /**
   * Mark item as complete
   */
  markComplete(itemId: string): void {
    const item = this.items.find(i => i.id === itemId);
    if (item) {
      item.state = 'complete';
      delete item.error;
    }
  }

  /**
   * Mark item as in progress
   */
  markInProgress(itemId: string): void {
    const item = this.items.find(i => i.id === itemId);
    if (item && item.state === 'pending') {
      item.state = 'in-progress';
    }
  }

  /**
   * Mark item as failed
   */
  markFailed(itemId: string, errorMsg?: string): void {
    const item = this.items.find(i => i.id === itemId);
    if (item) {
      item.state = 'failed';
      if (errorMsg) {
        item.error = errorMsg;
      }
    }
  }

  /**
   * Check if item is complete
   */
  isComplete(itemId: string): boolean {
    const item = this.items.find(i => i.id === itemId);
    return item?.state === 'complete';
  }

  /**
   * Check if item failed
   */
  isFailed(itemId: string): boolean {
    const item = this.items.find(i => i.id === itemId);
    return item?.state === 'failed';
  }

  /**
   * Check if item is in progress
   */
  isInProgress(itemId: string): boolean {
    const item = this.items.find(i => i.id === itemId);
    return item?.state === 'in-progress';
  }

  /**
   * Get progress percentage (0-100)
   */
  getProgress(): number {
    const completed = this.items.filter(i => i.state === 'complete').length;
    return Math.round((completed / this.items.length) * 100);
  }

  /**
   * Render as plain text with symbols
   */
  renderText(): string {
    const lines: string[] = [];

    lines.push(`${this.title}`);
    lines.push('='.repeat(this.title.length));
    lines.push('');

    for (const item of this.items) {
      const icon = this.getIcon(item.state);
      lines.push(`${icon} ${item.label}`);

      if (item.error) {
        lines.push(`  └─ Error: ${item.error}`);
      }
    }

    lines.push('');
    lines.push(`Progress: ${this.getProgress()}% (${this.getCompletedCount()}/${this.items.length})`);

    return lines.join('\n');
  }

  /**
   * Render as markdown checklist
   */
  renderMarkdown(): string {
    const lines: string[] = [];

    lines.push(`# ${this.title}\n`);

    for (const item of this.items) {
      const checkbox = item.state === 'complete' ? '[x]' : '[ ]';
      const label =
        item.state === 'failed' ? `~~${item.label}~~` : item.label;

      lines.push(`- ${checkbox} ${label}`);

      if (item.error) {
        lines.push(`  - ⚠️ ${item.error}`);
      }
    }

    lines.push('');
    const progress = this.getProgress();
    lines.push(`**Progress:** ${progress}% (${this.getCompletedCount()}/${this.items.length})`);

    return lines.join('\n');
  }

  /**
   * Get HTML rendering (for future UI integration)
   */
  renderHtml(): string {
    const items = this.items
      .map(item => {
        const checked = item.state === 'complete' ? 'checked' : '';
        const className =
          item.state === 'failed'
            ? 'class="failed"'
            : item.state === 'in-progress'
              ? 'class="in-progress"'
              : '';

        const errorHtml =
          item.error ? `<div class="error">${item.error}</div>` : '';

        return `<li ${className}><input type="checkbox" ${checked} disabled /> ${item.label}${errorHtml}</li>`;
      })
      .join('\n');

    const progress = this.getProgress();

    return `
      <div class="checklist">
        <h2>${this.title}</h2>
        <ul>${items}</ul>
        <div class="progress">
          <div class="bar" style="width: ${progress}%"></div>
          <span>${progress}%</span>
        </div>
      </div>
    `.trim();
  }

  /**
   * Get total completed count
   */
  private getCompletedCount(): number {
    return this.items.filter(i => i.state === 'complete').length;
  }

  /**
   * Get icon for item state
   */
  private getIcon(state: ItemState): string {
    switch (state) {
    case 'complete':
      return '✓';
    case 'in-progress':
      return '⟳';
    case 'failed':
      return '✗';
    case 'pending':
    default:
      return '□';
    }
  }
}
