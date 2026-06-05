/**
 * Tests for Checklist Renderer
 *
 * Renders visual startup checklist as text/markdown
 */

import { ChecklistRenderer } from './checklist-renderer';

describe('Checklist Renderer', () => {
  describe('initialization', () => {
    it('should create checklist with items', () => {
      const renderer = new ChecklistRenderer('Startup', [
        { id: 'bootstrap', label: 'Initialize services' },
        { id: 'preflight', label: 'Run preflight checks' },
        { id: 'validation', label: 'Run validation' },
      ]);

      expect(renderer.getTotalItems()).toBe(3);
    });
  });

  describe('state tracking', () => {
    it('should mark items as complete', () => {
      const renderer = new ChecklistRenderer('Startup', [
        { id: 'step1', label: 'First step' },
        { id: 'step2', label: 'Second step' },
      ]);

      renderer.markComplete('step1');
      expect(renderer.isComplete('step1')).toBe(true);
      expect(renderer.isComplete('step2')).toBe(false);
    });

    it('should mark items as failed', () => {
      const renderer = new ChecklistRenderer('Startup', [
        { id: 'step1', label: 'Step that fails' },
      ]);

      renderer.markFailed('step1', 'Failed because X');
      expect(renderer.isFailed('step1')).toBe(true);
    });

    it('should mark items in progress', () => {
      const renderer = new ChecklistRenderer('Startup', [
        { id: 'step1', label: 'Running step' },
      ]);

      renderer.markInProgress('step1');
      expect(renderer.isInProgress('step1')).toBe(true);
    });
  });

  describe('rendering', () => {
    it('should render as plain text with progress', () => {
      const renderer = new ChecklistRenderer('Test', [
        { id: 'a', label: 'Item A' },
        { id: 'b', label: 'Item B' },
      ]);

      renderer.markComplete('a');
      const text = renderer.renderText();

      expect(text).toContain('Item A');
      expect(text).toContain('Item B');
      expect(text).toContain('✓');
      expect(text).toContain('□');
    });

    it('should render as markdown', () => {
      const renderer = new ChecklistRenderer('Checklist', [
        { id: 'task1', label: 'Do something' },
        { id: 'task2', label: 'Do something else' },
      ]);

      renderer.markComplete('task1');
      const markdown = renderer.renderMarkdown();

      expect(markdown).toContain('# Checklist');
      expect(markdown).toContain('- [x]');
      expect(markdown).toContain('- [ ]');
    });

    it('should show progress percentage', () => {
      const renderer = new ChecklistRenderer('Progress', [
        { id: '1', label: 'Task 1' },
        { id: '2', label: 'Task 2' },
        { id: '3', label: 'Task 3' },
        { id: '4', label: 'Task 4' },
      ]);

      renderer.markComplete('1');
      renderer.markComplete('2');
      expect(renderer.getProgress()).toBe(50);

      const text = renderer.renderText();
      expect(text).toContain('50%');
    });

    it('should show failed items with error details', () => {
      const renderer = new ChecklistRenderer('Startup', [
        { id: 'step', label: 'Critical step' },
      ]);

      renderer.markFailed('step', 'Something went wrong');
      const text = renderer.renderText();

      expect(text).toContain('✗');
      expect(text).toContain('Something went wrong');
    });
  });

  describe('updates and progress', () => {
    it('should calculate progress correctly', () => {
      const renderer = new ChecklistRenderer('Test', [
        { id: '1', label: 'A' },
        { id: '2', label: 'B' },
        { id: '3', label: 'C' },
      ]);

      expect(renderer.getProgress()).toBe(0);
      renderer.markComplete('1');
      expect(renderer.getProgress()).toBe(33);
      renderer.markComplete('2');
      expect(renderer.getProgress()).toBe(67); // 2/3 = 66.66... rounds to 67
      renderer.markComplete('3');
      expect(renderer.getProgress()).toBe(100);
    });

    it('should update individual items without affecting others', () => {
      const renderer = new ChecklistRenderer('Test', [
        { id: 'a', label: 'Item A' },
        { id: 'b', label: 'Item B' },
        { id: 'c', label: 'Item C' },
      ]);

      renderer.markComplete('a');
      renderer.markInProgress('b');

      expect(renderer.isComplete('a')).toBe(true);
      expect(renderer.isInProgress('b')).toBe(true);
      expect(renderer.isComplete('c')).toBe(false);
      expect(renderer.isInProgress('c')).toBe(false);
    });
  });
});
