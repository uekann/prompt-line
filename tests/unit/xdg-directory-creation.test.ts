import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import path from 'path';
import os from 'os';

// Mock fs before importing app-config
const mockExistsSync = jest.fn() as jest.MockedFunction<(path: string) => boolean>;
const mockMkdirSync = jest.fn() as jest.MockedFunction<(path: string, options?: { recursive?: boolean }) => void>;
const mockConsoleError = jest.fn();

jest.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  readFileSync: jest.fn(() => ''),
  writeFileSync: jest.fn()
}));

// Store original console.error
const originalConsoleError = console.error;

describe('XDG Directory Creation', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Store original environment
    originalEnv = { ...process.env };

    // Reset mocks
    jest.clearAllMocks();
    mockExistsSync.mockReturnValue(false); // Default: directories don't exist
    mockMkdirSync.mockImplementation(() => undefined);

    // Mock console.error
    console.error = mockConsoleError;

    // Clear module cache to force re-import
    jest.resetModules();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;

    // Restore console.error
    console.error = originalConsoleError;
  });

  test('should create config directory when it does not exist', async () => {
    // Set up environment: ~/.config exists
    process.env.NODE_ENV = 'development';
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    delete process.env.XDG_STATE_HOME;

    mockExistsSync.mockImplementation((p: string) => {
      // ~/.config exists, but prompt-line subdirs don't
      if (p === path.join(os.homedir(), '.config')) return true;
      if (p === path.join(os.homedir(), '.local', 'share')) return true;
      if (p === path.join(os.homedir(), '.local', 'state')) return true;
      return false;
    });

    // Import app-config (triggers directory creation)
    await import('../../src/config/app-config');

    // Verify config directory creation was attempted
    expect(mockMkdirSync).toHaveBeenCalledWith(
      path.join(os.homedir(), '.config', 'prompt-line'),
      { recursive: true }
    );
  });

  test('should create data directory when it does not exist', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    delete process.env.XDG_STATE_HOME;

    mockExistsSync.mockImplementation((p: string) => {
      if (p === path.join(os.homedir(), '.config')) return true;
      if (p === path.join(os.homedir(), '.local', 'share')) return true;
      if (p === path.join(os.homedir(), '.local', 'state')) return true;
      return false;
    });

    await import('../../src/config/app-config');

    expect(mockMkdirSync).toHaveBeenCalledWith(
      path.join(os.homedir(), '.local', 'share', 'prompt-line'),
      { recursive: true }
    );
  });

  test('should create state directory when it does not exist', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    delete process.env.XDG_STATE_HOME;

    mockExistsSync.mockImplementation((p: string) => {
      if (p === path.join(os.homedir(), '.config')) return true;
      if (p === path.join(os.homedir(), '.local', 'share')) return true;
      if (p === path.join(os.homedir(), '.local', 'state')) return true;
      return false;
    });

    await import('../../src/config/app-config');

    expect(mockMkdirSync).toHaveBeenCalledWith(
      path.join(os.homedir(), '.local', 'state', 'prompt-line'),
      { recursive: true }
    );
  });

  test('should create images subdirectory in data directory', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    delete process.env.XDG_STATE_HOME;

    mockExistsSync.mockImplementation((p: string) => {
      if (p === path.join(os.homedir(), '.config')) return true;
      if (p === path.join(os.homedir(), '.local', 'share')) return true;
      if (p === path.join(os.homedir(), '.local', 'state')) return true;
      return false;
    });

    await import('../../src/config/app-config');

    expect(mockMkdirSync).toHaveBeenCalledWith(
      path.join(os.homedir(), '.local', 'share', 'prompt-line', 'images'),
      { recursive: true }
    );
  });

  test('should use custom XDG_CONFIG_HOME when set', async () => {
    process.env.NODE_ENV = 'development';
    process.env.XDG_CONFIG_HOME = '/custom/config';
    delete process.env.XDG_DATA_HOME;
    delete process.env.XDG_STATE_HOME;

    mockExistsSync.mockImplementation((p: string) => {
      if (p === path.join(os.homedir(), '.local', 'share')) return true;
      if (p === path.join(os.homedir(), '.local', 'state')) return true;
      return false;
    });

    await import('../../src/config/app-config');

    expect(mockMkdirSync).toHaveBeenCalledWith(
      '/custom/config/prompt-line',
      { recursive: true }
    );
  });

  test('should use custom XDG_DATA_HOME when set', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.XDG_CONFIG_HOME;
    process.env.XDG_DATA_HOME = '/custom/data';
    delete process.env.XDG_STATE_HOME;

    mockExistsSync.mockImplementation((p: string) => {
      if (p === path.join(os.homedir(), '.config')) return true;
      if (p === path.join(os.homedir(), '.local', 'state')) return true;
      return false;
    });

    await import('../../src/config/app-config');

    expect(mockMkdirSync).toHaveBeenCalledWith(
      '/custom/data/prompt-line',
      { recursive: true }
    );
  });

  test('should use custom XDG_STATE_HOME when set', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    process.env.XDG_STATE_HOME = '/custom/state';

    mockExistsSync.mockImplementation((p: string) => {
      if (p === path.join(os.homedir(), '.config')) return true;
      if (p === path.join(os.homedir(), '.local', 'share')) return true;
      return false;
    });

    await import('../../src/config/app-config');

    expect(mockMkdirSync).toHaveBeenCalledWith(
      '/custom/state/prompt-line',
      { recursive: true }
    );
  });

  test('should not create directories if they already exist', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    delete process.env.XDG_STATE_HOME;

    // All directories already exist
    mockExistsSync.mockReturnValue(true);

    await import('../../src/config/app-config');

    // Should not call mkdirSync for any directory
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });

  test('should skip directory creation in test environment', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    delete process.env.XDG_STATE_HOME;

    mockExistsSync.mockReturnValue(false);

    await import('../../src/config/app-config');

    // Should not create directories in test environment
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });

  test('should handle directory creation errors gracefully', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    delete process.env.XDG_STATE_HOME;

    mockExistsSync.mockImplementation((p: string) => {
      if (p === path.join(os.homedir(), '.config')) return true;
      if (p === path.join(os.homedir(), '.local', 'share')) return true;
      if (p === path.join(os.homedir(), '.local', 'state')) return true;
      return false;
    });

    // Simulate permission error
    mockMkdirSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    // Should not throw error during import
    await expect(import('../../src/config/app-config')).resolves.toBeDefined();

    // Should log error
    expect(mockConsoleError).toHaveBeenCalledWith(
      'Failed to create XDG directories during initialization:',
      expect.any(Error)
    );
  });

  test('should fall back to ~/.prompt-line when ~/.config does not exist', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    delete process.env.XDG_STATE_HOME;

    mockExistsSync.mockImplementation((p: string) => {
      // ~/.config, ~/.local/share, ~/.local/state do NOT exist
      if (p === path.join(os.homedir(), '.config')) return false;
      if (p === path.join(os.homedir(), '.local', 'share')) return false;
      if (p === path.join(os.homedir(), '.local', 'state')) return false;
      return false;
    });

    await import('../../src/config/app-config');

    // Should create legacy ~/.prompt-line directory
    expect(mockMkdirSync).toHaveBeenCalledWith(
      path.join(os.homedir(), '.prompt-line'),
      { recursive: true }
    );
  });
});
