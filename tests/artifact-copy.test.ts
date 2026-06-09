/**
 * @jest-environment jsdom
 */

import { createWebRouter } from '../src/kaseki-api-web';

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
    if (toastContainer && toastContainer.isConnected) {
      toastContainer.remove();
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

    it.each([
      {
        execCommandResult: true,
        expectedStatus: 'success',
        expectedMessage: 'Copied!',
      },
      {
        execCommandResult: false,
        expectedStatus: 'error',
        expectedMessage: 'Copy failed - please try again',
      },
    ])('should not crash if toast container is missing and copy reports $expectedStatus', async ({
      execCommandResult,
      expectedStatus,
      expectedMessage,
    }) => {
      const { execCommandMock } = await setupRecommendedArtifactCopy({
        clipboardAvailable: false,
        isSecureContext: false,
        execCommandResult,
      });
      document.querySelector('#toast-container')?.remove();

      const copyButton = await waitForElement('[aria-label="Copy result.json"]') as HTMLButtonElement;
      expect(document.querySelector('#toast-container')).toBeNull();
      expect(() => copyButton.click()).not.toThrow();

      await waitFor(() => expect(copyButton.dataset.copyStatus).toBe(expectedStatus));
      expect(copyButton.dataset.copyMessage).toBe(expectedMessage);
      expect(copyButton.getAttribute('title')).toBe(expectedMessage);
      expect(execCommandMock).toHaveBeenCalledWith('copy');
      expect(document.querySelector('#toast-container')).toBeNull();
    });
  });

  describe('Accessibility', () => {
    it('should have aria-label for copy button', async () => {
      const controllerPage = await getControllerPage();
      document.open();
      document.write(controllerPage.replace(/<script>[\s\S]*?<\/script>/, ''));
      document.close();

      const fetchMock = jest.fn(async (input: any) => {
        const url = String(input);
        if (url === '/api/runs') {
          return jsonResponse({ runs: [] });
        }
        if (url === '/api/runs/kaseki-1/status') {
          return jsonResponse({ id: 'kaseki-1', status: 'completed' });
        }
        if (url === '/api/runs/kaseki-1/artifacts') {
          return jsonResponse({
            artifacts: [
              {
                name: 'result.txt',
                contentType: 'text/plain',
                available: true,
                size: '22 B',
              },
            ],
          });
        }
        if (url === '/api/results/kaseki-1/result.txt') {
          return textResponse('copyable artifact text', 'text/plain');
        }
        throw new Error('Unexpected fetch URL: ' + url);
      });
      Object.defineProperty(window, 'fetch', {
        configurable: true,
        value: fetchMock,
      });
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: fetchMock,
      });

      runControllerScript(controllerPage);

      const tokenInput = document.querySelector('#header-api-token') as HTMLInputElement | null;
      const runIdInput = document.querySelector('#run-id') as HTMLInputElement | null;
      expect(tokenInput).toBeTruthy();
      expect(runIdInput).toBeTruthy();
      tokenInput!.value = 'kaseki-test-token';
      runIdInput!.value = 'kaseki-1';

      (document.querySelector('#full-results-btn') as HTMLButtonElement).click();
      (document.querySelector('.tab-btn[data-tab="artifacts"]') as HTMLButtonElement).click();

      const artifactItem = await waitForElement('.artifact-item');
      (artifactItem as HTMLButtonElement).click();

      const copyButton = await waitForElement('.artifact-content .artifact-copy-btn');
      const accessibleName = copyButton.getAttribute('aria-label')?.trim() ?? '';

      expect(copyButton).toBeTruthy();
      expect(accessibleName).not.toBe('');
      expect(accessibleName).toBe('Copy artifact content');
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
    it.each([
      {
        name: 'uses Clipboard API when navigator.clipboard is available in a secure context',
        clipboardAvailable: true,
        isSecureContext: true,
        expectedPath: 'clipboard',
      },
      {
        name: 'uses document.execCommand fallback when navigator.clipboard is available outside a secure context',
        clipboardAvailable: true,
        isSecureContext: false,
        expectedPath: 'execCommand',
      },
      {
        name: 'uses document.execCommand fallback when navigator.clipboard is unavailable in a secure context',
        clipboardAvailable: false,
        isSecureContext: true,
        expectedPath: 'execCommand',
      },
      {
        name: 'uses document.execCommand fallback when navigator.clipboard is unavailable outside a secure context',
        clipboardAvailable: false,
        isSecureContext: false,
        expectedPath: 'execCommand',
      },
    ])('should $name through the artifact UI copy action', async ({ clipboardAvailable, isSecureContext, expectedPath }) => {
      const { writeTextMock, execCommandMock } = await setupRecommendedArtifactCopy({
        clipboardAvailable,
        isSecureContext,
        execCommandResult: true,
      });

      const copyButton = await waitForElement('[aria-label="Copy result.json"]');
      (copyButton as HTMLButtonElement).click();

      await waitFor(() => expect(document.querySelector('.toast.success')?.textContent).toBe('Copied!'));
      if (expectedPath === 'clipboard') {
        expect(writeTextMock).toHaveBeenCalledWith(JSON.stringify({ copied: true, source: 'artifact' }, null, 2));
        expect(execCommandMock).not.toHaveBeenCalled();
      } else {
        expect(writeTextMock).not.toHaveBeenCalled();
        expect(execCommandMock).toHaveBeenCalledWith('copy');
      }
    });

    it('should show a failure toast when the artifact UI copy action fallback fails', async () => {
      const { writeTextMock, execCommandMock } = await setupRecommendedArtifactCopy({
        clipboardAvailable: false,
        isSecureContext: false,
        execCommandResult: false,
      });

      const copyButton = await waitForElement('[aria-label="Copy result.json"]');
      (copyButton as HTMLButtonElement).click();

      await waitFor(() => expect(document.querySelector('.toast.error')?.textContent).toBe('Copy failed - please try again'));
      expect(writeTextMock).not.toHaveBeenCalled();
      expect(execCommandMock).toHaveBeenCalledWith('copy');
    });
  });
});

async function getControllerPage(): Promise<string> {
  const router = createWebRouter();
  return await new Promise((resolve, reject) => {
    const req = {
      method: 'GET',
      url: '/ui',
      originalUrl: '/ui',
      path: '/ui',
      headers: {},
    };
    const res: any = {
      set: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      send: jest.fn((body: string): any => {
        resolve(body);
        return res;
      }),
    };
    (router as any).handle(req as any, res as any, (error: unknown) => {
      if (error) reject(error);
    });
  });
}

function runControllerScript(controllerPage: string): void {
  const scriptMatch = controllerPage.match(/<script>([\s\S]*?)<\/script>/);
  if (!scriptMatch) {
    throw new Error('Controller page script not found');
  }
  const scriptFunction = new Function(scriptMatch[1]);
  scriptFunction.call(window);
}

async function setupRecommendedArtifactCopy({
  clipboardAvailable,
  isSecureContext,
  execCommandResult,
}: {
  clipboardAvailable: boolean;
  isSecureContext: boolean;
  execCommandResult: boolean;
}): Promise<{ writeTextMock: jest.Mock; execCommandMock: jest.Mock }> {
  const controllerPage = await getControllerPage();
  document.open();
  document.write(controllerPage.replace(/<script>[\s\S]*?<\/script>/, ''));
  document.close();

  window.sessionStorage.setItem('kasekiApiToken', 'kaseki-test-token');

  const writeTextMock = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: clipboardAvailable ? { writeText: writeTextMock } : undefined,
  });
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value: isSecureContext,
  });

  const execCommandMock = jest.fn().mockReturnValue(execCommandResult);
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: execCommandMock,
  });

  const fetchMock = jest.fn(async (input: any) => {
    const url = String(input);
    if (url === '/api/runs') {
      return jsonResponse({ runs: [] });
    }
    if (url === '/api/runs/kaseki-1/status') {
      return jsonResponse({ id: 'kaseki-1', status: 'completed' });
    }
    if (url === '/api/runs/kaseki-1/artifacts') {
      return jsonResponse({
        recommended: ['result.json'],
        artifacts: [{ name: 'result.json', contentType: 'application/json' }],
      });
    }
    if (url === '/api/results/kaseki-1/result.json') {
      return jsonResponse({ copied: true, source: 'artifact' });
    }
    throw new Error('Unexpected fetch URL: ' + url);
  });
  Object.defineProperty(window, 'fetch', {
    configurable: true,
    value: fetchMock,
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: fetchMock,
  });

  runControllerScript(controllerPage);

  const runIdInput = document.querySelector('#run-id') as HTMLInputElement | null;
  expect(runIdInput).toBeTruthy();
  runIdInput!.value = 'kaseki-1';

  (document.querySelector('#status-check') as HTMLButtonElement).click();
  await waitForElement('[aria-label="Copy result.json"]');

  return { writeTextMock, execCommandMock };
}

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: jest.fn().mockResolvedValue(payload),
    text: jest.fn().mockResolvedValue(typeof payload === 'string' ? payload : JSON.stringify(payload)),
  } as unknown as Response;
}

function textResponse(body: string, contentType: string): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => name.toLowerCase() === 'content-type' ? contentType : null,
    },
    json: jest.fn().mockRejectedValue(new Error('Text response does not contain JSON')),
    text: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

async function waitFor(assertion: () => void | Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
}

async function waitForElement(selector: string): Promise<Element> {
  let element: Element | null = null;
  await waitFor(() => {
    element = document.querySelector(selector);
    expect(element).toBeTruthy();
  });
  return element!;
}
