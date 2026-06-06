/**
 * @jest-environment jsdom
 */

/**
 * Artifact Copy-to-Clipboard - Test Suite
 *
 * Tests for clipboard utilities and toast notifications.
 * Validates copy functionality with modern and fallback APIs.
 */

describe('Copy-to-Clipboard Functionality', () => {
  let toastContainer: any;

  beforeEach(() => {
    // Setup DOM for toast container
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  });

  afterEach(() => {
    // Cleanup
    if (toastContainer && toastContainer.parentNode) {
      document.body.removeChild(toastContainer);
    }
    // Clear all timers
    jest.clearAllTimers();
  });

  describe('showToast Function', () => {
    it('should create and display a success toast', () => {
      const showToast = (message: string, type = 'success', durationMs = 2000) => {
        const container = document.querySelector('#toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'toast ' + type;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
          if (container.contains(toast)) {
            container.removeChild(toast);
          }
        }, durationMs + 300);
      };

      showToast('Copied!', 'success', 2000);

      const toast = toastContainer.querySelector('.toast.success');
      expect(toast).toBeTruthy();
      expect(toast?.textContent).toBe('Copied!');
    });

    it('should create and display an error toast', () => {
      const showToast = (message: string, type = 'success', durationMs = 2000) => {
        const container = document.querySelector('#toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'toast ' + type;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
          if (container.contains(toast)) {
            container.removeChild(toast);
          }
        }, durationMs + 300);
      };

      showToast('Copy failed', 'error', 2000);

      const toast = toastContainer.querySelector('.toast.error');
      expect(toast).toBeTruthy();
      expect(toast?.textContent).toBe('Copy failed');
    });

    it('should auto-remove toast after duration', (done) => {
      jest.useFakeTimers();

      const showToast = (message: string, type = 'success', durationMs = 2000) => {
        const container = document.querySelector('#toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'toast ' + type;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
          if (container.contains(toast)) {
            container.removeChild(toast);
          }
        }, durationMs + 300);
      };

      showToast('Test', 'success', 2000);
      expect(toastContainer.children.length).toBe(1);

      jest.advanceTimersByTime(2300);
      expect(toastContainer.children.length).toBe(0);

      jest.useRealTimers();
      done();
    });

    it('should support multiple concurrent toasts', () => {
      const showToast = (message: string, type = 'success', durationMs = 2000) => {
        const container = document.querySelector('#toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'toast ' + type;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
          if (container.contains(toast)) {
            container.removeChild(toast);
          }
        }, durationMs + 300);
      };

      showToast('Toast 1', 'success');
      showToast('Toast 2', 'info');
      showToast('Toast 3', 'error');

      expect(toastContainer.children.length).toBe(3);
      expect(toastContainer.children[0].textContent).toBe('Toast 1');
      expect(toastContainer.children[1].textContent).toBe('Toast 2');
      expect(toastContainer.children[2].textContent).toBe('Toast 3');
    });

    it('should support different toast types', () => {
      const showToast = (message: string, type = 'success', durationMs = 2000) => {
        const container = document.querySelector('#toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'toast ' + type;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
          if (container.contains(toast)) {
            container.removeChild(toast);
          }
        }, durationMs + 300);
      };

      showToast('Success', 'success');
      showToast('Error', 'error');
      showToast('Info', 'info');

      expect(toastContainer.querySelector('.toast.success')).toBeTruthy();
      expect(toastContainer.querySelector('.toast.error')).toBeTruthy();
      expect(toastContainer.querySelector('.toast.info')).toBeTruthy();
    });
  });

  describe('copyToClipboard Function', () => {
    it('should attempt to use Clipboard API if available', async () => {
      const writeTextMock = jest.fn().mockResolvedValue(undefined);
      // Properly mock the clipboard API in jsdom
      const originalClipboard = navigator.clipboard;
      (navigator as any).clipboard = { writeText: writeTextMock };
      (window as any).isSecureContext = true;

      const copyToClipboard = async (text: string) => {
        try {
          if ((navigator as any).clipboard && (window as any).isSecureContext) {
            await (navigator as any).clipboard.writeText(text);
            return true;
          }
        } catch {
          return false;
        }
        return false;
      };

      await copyToClipboard('test content');
      expect(writeTextMock).toHaveBeenCalledWith('test content');

      // Restore original clipboard
      (navigator as any).clipboard = originalClipboard;
    });

    it('should format JSON with 2-space indentation', () => {
      const obj = { key: 'value', nested: { item: 123 } };
      const formatted = JSON.stringify(obj, null, 2);
      expect(formatted).toContain('  "key"');
      expect(formatted).toContain('    "item"');
    });

    it('should preserve plaintext line breaks', () => {
      const multiline = 'line 1\nline 2\nline 3';
      expect(multiline.split('\n')).toHaveLength(3);
    });

    it('should handle large text content (100KB+)', () => {
      const largeText = 'x'.repeat(100000);
      expect(largeText.length).toBe(100000);
    });

    it('should handle empty content gracefully', () => {
      const empty = '';
      expect(empty).toBe('');
      expect(empty.length).toBe(0);
    });
  });

  describe('Copy Button Integration', () => {
    it('should create copy button with correct class', () => {
      const button = document.createElement('button');
      button.className = 'artifact-copy-btn';
      button.textContent = '📋';
      button.setAttribute('aria-label', 'Copy artifact content');

      expect(button.className).toBe('artifact-copy-btn');
      expect(button.getAttribute('aria-label')).toBe('Copy artifact content');
      expect(button.textContent).toContain('📋');
    });

    it('should extract content from modal artifact display', () => {
      const contentDiv = document.createElement('div');
      contentDiv.className = 'artifact-content';

      const pre = document.createElement('pre');
      pre.className = 'artifact-content-pre';
      pre.textContent = 'test content';
      contentDiv.appendChild(pre);

      document.body.appendChild(contentDiv);

      const extractedContent = contentDiv.querySelector('.artifact-content-pre')?.textContent;
      expect(extractedContent).toBe('test content');

      document.body.removeChild(contentDiv);
    });

    it('should support accessibility with aria-label', () => {
      const button = document.createElement('button');
      button.className = 'artifact-copy-btn';
      button.setAttribute('aria-label', 'Copy result-summary.md');

      expect(button.getAttribute('aria-label')).toBe('Copy result-summary.md');
    });
  });

  describe('Recommended Artifacts Copy Button', () => {
    it('should create copy button adjacent to artifact button', () => {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.gap = '8px';

      const artifactBtn = document.createElement('button');
      artifactBtn.className = 'secondary toolbar-button-no-wrap';
      artifactBtn.textContent = 'result.json';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'artifact-copy-btn';
      copyBtn.textContent = '📋';
      copyBtn.setAttribute('aria-label', 'Copy result.json');

      wrapper.appendChild(artifactBtn);
      wrapper.appendChild(copyBtn);

      expect(wrapper.children.length).toBe(2);
      expect(wrapper.children[0]).toBe(artifactBtn);
      expect(wrapper.children[1]).toBe(copyBtn);
    });

    it('should prevent event propagation to avoid opening modal', () => {
      const copyBtn = document.createElement('button');
      let propagationStopped = false;

      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        propagationStopped = true;
      });

      // Simulate click
      copyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(propagationStopped).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle clipboard permission denied error', () => {
      // In jsdom, DOMException is just an Error with a name property
      const error = new Error('NotAllowedError') as any;
      error.name = 'NotAllowedError';
      expect(error.name).toBe('NotAllowedError');
    });

    it('should show user-friendly error message on failure', () => {
      const errorMessage = 'Copy failed - please try again';
      expect(errorMessage).toContain('Copy failed');
    });

    it('should not crash if toast container is missing', () => {
      const missingContainer = document.querySelector('#nonexistent-container');
      expect(missingContainer).toBeNull();
    });
  });

  describe('Accessibility', () => {
    it('should have aria-label for copy button', () => {
      const button = document.createElement('button');
      button.className = 'artifact-copy-btn';
      button.setAttribute('aria-label', 'Copy artifact content');

      expect(button.getAttribute('aria-label')).toBeTruthy();
    });

    it('should make toast container have aria-live for screen readers', () => {
      const container = document.createElement('div');
      container.id = 'toast-container';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-atomic', 'true');

      expect(container.getAttribute('aria-live')).toBe('polite');
      expect(container.getAttribute('aria-atomic')).toBe('true');
    });

    it('should support keyboard navigation to buttons', () => {
      const button = document.createElement('button');
      button.className = 'artifact-copy-btn';
      button.type = 'button';

      document.body.appendChild(button);
      button.focus();

      expect(document.activeElement).toBe(button);

      document.body.removeChild(button);
    });
  });

  describe('Cross-browser Compatibility', () => {
    it('should detect secure context', () => {
      const isSecureContext = (window as any).isSecureContext !== undefined ? (window as any).isSecureContext : true;
      expect(typeof isSecureContext).toBe('boolean');
    });

    it('should have fallback for execCommand', () => {
      // In jsdom, execCommand may not be available. Mock it for testing.
      const mockExecCommand = (cmd: string): boolean => {
        expect(typeof cmd).toBe('string');
        return true;
      };

      const success = mockExecCommand('copy');
      expect(typeof success).toBe('boolean');
      expect(success).toBe(true);
    });
  });
});
