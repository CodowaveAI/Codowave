import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock process.exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called');
});
const mockExitCode = vi.spyOn(process, 'exit').mockReturnValue(undefined as unknown as never);

// Mock the config module
vi.mock('../../config', () => ({
  readConfig: vi.fn(),
  readConfigOrThrow: vi.fn(),
  updateConfig: vi.fn(),
  getConfigPath: vi.fn(() => '/home/user/.codowave/config.json'),
}));

import { readConfig, readConfigOrThrow, updateConfig, getConfigPath } from '../../config';
import { configCommand } from '../config-cmd';

const mockReadConfig = vi.mocked(readConfig);
const mockReadConfigOrThrow = vi.mocked(readConfigOrThrow);
const mockUpdateConfig = vi.mocked(updateConfig);
const mockGetConfigPath = vi.mocked(getConfigPath);

describe('config command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExit.mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    mockExit.mockRestore();
    mockExitCode.mockRestore();
  });

  describe('config list', () => {
    it('should list all available config options', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      // Create a fresh command instance and add the config command
      const program = new Command();
      program.addCommand(configCommand);
      
      // Execute the list subcommand
      await program.parseAsync(['node', 'test', 'config', 'list']);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('apiKey')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('apiUrl')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('repos')
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('config get', () => {
    it('should get apiUrl config value', async () => {
      mockReadConfigOrThrow.mockReturnValue({
        apiKey: 'test-key',
        apiUrl: 'https://api.codowave.com',
        repos: [],
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const program = new Command();
      program.addCommand(configCommand);

      await program.parseAsync(['node', 'test', 'config', 'get', 'apiUrl']);

      expect(consoleSpy).toHaveBeenCalledWith('https://api.codowave.com');

      consoleSpy.mockRestore();
    });

    it('should handle unknown config key', async () => {
      mockReadConfigOrThrow.mockReturnValue({
        apiKey: 'test-key',
        apiUrl: 'https://api.codowave.com',
        repos: [],
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const program = new Command();
      program.addCommand(configCommand);

      let threw = false;
      try {
        await program.parseAsync(['node', 'test', 'config', 'get', 'unknownKey']);
      } catch (e) {
        threw = true;
      }

      expect(threw).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown config key')
      );

      consoleSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should get configPath', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const program = new Command();
      program.addCommand(configCommand);

      await program.parseAsync(['node', 'test', 'config', 'get', 'configPath']);

      expect(consoleSpy).toHaveBeenCalledWith('/home/user/.codowave/config.json');

      consoleSpy.mockRestore();
    });

    it('should show repos when getting repos', async () => {
      mockReadConfigOrThrow.mockReturnValue({
        apiKey: 'test-key',
        apiUrl: 'https://api.codowave.com',
        repos: [
          { owner: 'test-owner', name: 'test-repo', id: 'repo-123' },
          { owner: 'other-owner', name: 'other-repo' },
        ],
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const program = new Command();
      program.addCommand(configCommand);

      await program.parseAsync(['node', 'test', 'config', 'get', 'repos']);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('test-owner/test-repo')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('repo-123')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('other-owner/other-repo')
      );

      consoleSpy.mockRestore();
    });

    it('should handle missing config', async () => {
      mockReadConfigOrThrow.mockImplementation(() => {
        throw new Error('No config found');
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const program = new Command();
      program.addCommand(configCommand);

      let threw = false;
      try {
        await program.parseAsync(['node', 'test', 'config', 'get', 'apiUrl']);
      } catch (e) {
        threw = true;
      }

      expect(threw).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('No config found')
      );

      errorSpy.mockRestore();
    });
  });

  describe('config set', () => {
    it('should set apiKey', async () => {
      mockUpdateConfig.mockReturnValue({
        apiKey: 'new-key',
        apiUrl: 'https://api.codowave.com',
        repos: [],
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const program = new Command();
      program.addCommand(configCommand);

      await program.parseAsync(['node', 'test', 'config', 'set', 'apiKey', 'new-key']);

      expect(mockUpdateConfig).toHaveBeenCalledWith({ apiKey: 'new-key' });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updated apiKey')
      );

      consoleSpy.mockRestore();
    });

    it('should set apiUrl with valid URL', async () => {
      mockUpdateConfig.mockReturnValue({
        apiKey: 'test-key',
        apiUrl: 'https://custom.api.com',
        repos: [],
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const program = new Command();
      program.addCommand(configCommand);

      await program.parseAsync(['node', 'test', 'config', 'set', 'apiUrl', 'https://custom.api.com']);

      expect(mockUpdateConfig).toHaveBeenCalledWith({ apiUrl: 'https://custom.api.com' });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updated apiUrl')
      );

      consoleSpy.mockRestore();
    });

    it('should reject invalid URL', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const program = new Command();
      program.addCommand(configCommand);

      let threw = false;
      try {
        await program.parseAsync(['node', 'test', 'config', 'set', 'apiUrl', 'not-a-url']);
      } catch (e) {
        threw = true;
      }

      expect(mockUpdateConfig).not.toHaveBeenCalled();
      expect(threw).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid URL')
      );

      consoleSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should reject setting invalid keys', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const program = new Command();
      program.addCommand(configCommand);

      let threw = false;
      try {
        await program.parseAsync(['node', 'test', 'config', 'set', 'repos', 'some-value']);
      } catch (e) {
        threw = true;
      }

      expect(mockUpdateConfig).not.toHaveBeenCalled();
      expect(threw).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cannot set 'repos'")
      );

      consoleSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe('config show', () => {
    it('should show all config values', async () => {
      mockReadConfigOrThrow.mockReturnValue({
        apiKey: 'test-key-123',
        apiUrl: 'https://api.codowave.com',
        repos: [
          { owner: 'owner1', name: 'repo1' },
        ],
      });
      mockGetConfigPath.mockReturnValue('/home/user/.codowave/config.json');

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const program = new Command();
      program.addCommand(configCommand);

      await program.parseAsync(['node', 'test', 'config', 'show']);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('apiKey')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('apiUrl')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('repos')
      );

      consoleSpy.mockRestore();
    });

    it('should handle missing config', async () => {
      mockReadConfigOrThrow.mockImplementation(() => {
        throw new Error('No config found');
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const program = new Command();
      program.addCommand(configCommand);

      let threw = false;
      try {
        await program.parseAsync(['node', 'test', 'config', 'show']);
      } catch (e) {
        threw = true;
      }

      expect(threw).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('No config found')
      );

      errorSpy.mockRestore();
    });

    it('should show empty repos message', async () => {
      mockReadConfigOrThrow.mockReturnValue({
        apiKey: 'test-key',
        apiUrl: 'https://api.codowave.com',
        repos: [],
      });
      mockGetConfigPath.mockReturnValue('/home/user/.codowave/config.json');

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const program = new Command();
      program.addCommand(configCommand);

      await program.parseAsync(['node', 'test', 'config', 'show']);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('0 repository(s)')
      );

      consoleSpy.mockRestore();
    });
  });
});
