import { ConfigManager } from '../config/ConfigManager';
import { KasekiCLI } from './KasekiCLI';

describe('KasekiCLI', () => {
  test('does not expose the deprecated setup alias', async () => {
    const cli = new KasekiCLI({} as ConfigManager);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(cli.dispatch('setup', ['--help'])).resolves.toBe(1);
      expect(consoleError).toHaveBeenCalledWith('Unknown command: setup');
    } finally {
      consoleError.mockRestore();
    }
  });
});
