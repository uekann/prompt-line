import path from 'path';
import os from 'os';
import { existsSync, mkdirSync } from 'fs';
import type {
  WindowConfig,
  ShortcutsConfig,
  PathsConfig,
  HistoryConfig,
  DraftConfig,
  TimingConfig,
  AppConfig,
  PlatformConfig,
  LoggingConfig,
  LogLevel
} from '../types';

// Import package.json to get the version dynamically
import packageJson from '../../package.json';

/**
 * Resolves XDG config directory path according to XDG Base Directory specification
 * Priority: $XDG_CONFIG_HOME → ~/.config (if exists) → ~/.prompt-line
 */
function getXdgConfigDir(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, 'prompt-line');
  }

  const configDir = path.join(os.homedir(), '.config');
  if (existsSync(configDir)) {
    return path.join(configDir, 'prompt-line');
  }

  return path.join(os.homedir(), '.prompt-line');
}

/**
 * Resolves XDG data directory path according to XDG Base Directory specification
 * Priority: $XDG_DATA_HOME → ~/.local/share (if exists) → ~/.prompt-line
 */
function getXdgDataDir(): string {
  const xdgDataHome = process.env.XDG_DATA_HOME;
  if (xdgDataHome) {
    return path.join(xdgDataHome, 'prompt-line');
  }

  const dataDir = path.join(os.homedir(), '.local', 'share');
  if (existsSync(dataDir)) {
    return path.join(dataDir, 'prompt-line');
  }

  return path.join(os.homedir(), '.prompt-line');
}

/**
 * Resolves XDG state directory path according to XDG Base Directory specification
 * Priority: $XDG_STATE_HOME → ~/.local/state (if exists) → ~/.prompt-line
 */
function getXdgStateDir(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome) {
    return path.join(xdgStateHome, 'prompt-line');
  }

  const stateDir = path.join(os.homedir(), '.local', 'state');
  if (existsSync(stateDir)) {
    return path.join(stateDir, 'prompt-line');
  }

  return path.join(os.homedir(), '.prompt-line');
}

/**
 * Ensures XDG directories exist by creating them if necessary
 * This is called synchronously during app initialization
 */
function ensureXdgDirectories(configDir: string, dataDir: string, stateDir: string): void {
  try {
    // Create config directory
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    // Create data directory
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    // Create state directory
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }

    // Create images subdirectory in data directory
    const imagesDir = path.join(dataDir, 'images');
    if (!existsSync(imagesDir)) {
      mkdirSync(imagesDir, { recursive: true });
    }
  } catch (error) {
    // Log error but don't fail app initialization
    // Directories will be created later by individual managers if needed
    console.error('Failed to create XDG directories during initialization:', error);
  }
}

class AppConfigClass {
  public window!: WindowConfig;
  public shortcuts!: ShortcutsConfig;
  public paths!: PathsConfig;
  public history!: HistoryConfig;
  public draft!: DraftConfig;
  public timing!: TimingConfig;
  public app!: AppConfig;
  public platform!: PlatformConfig;
  public logging!: LoggingConfig;

  constructor() {
    this.init();
  }

  private init(): void {
    this.window = {
      width: 600,
      height: 300,
      frame: false,
      transparent: false,
      backgroundColor: '#141414',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      webPreferences: {
        // Enhanced security configuration
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        
        // Maintain existing settings
        spellcheck: false,
        disableDialogs: true,
        enableWebSQL: false,
        experimentalFeatures: false,
        defaultEncoding: 'UTF-8',
        offscreen: false,
        enablePreferredSizeMode: false,
        disableHtmlFullscreenWindowResize: true,
        
        // Additional security settings
        allowRunningInsecureContent: false,
        sandbox: false,  // Disabled for accessibility features (required for auto-paste)
      }
    };

    this.shortcuts = {
      main: 'Cmd+Shift+Space',
      paste: 'Cmd+Enter',
      close: 'Escape',
      historyNext: 'Ctrl+j',
      historyPrev: 'Ctrl+k',
      search: 'Cmd+f'
    };

    // Resolve XDG Base Directory paths
    const configDir = getXdgConfigDir();
    const dataDir = getXdgDataDir();
    const stateDir = getXdgStateDir();

    this.paths = {
      // XDG Base Directory paths
      configDir,
      dataDir,
      stateDir,

      // Legacy path for backward compatibility
      userDataDir: dataDir,

      // File paths using XDG directories
      get settingsFile() {
        return path.join(configDir, 'settings.yml');
      },
      get historyFile() {
        return path.join(dataDir, 'history.jsonl');
      },
      get draftFile() {
        return path.join(dataDir, 'draft.json');
      },
      get logFile() {
        return path.join(stateDir, 'app.log');
      },
      get imagesDir() {
        return path.join(dataDir, 'images');
      }
    };

    this.history = {
      saveInterval: 1000
    };

    this.draft = {
      saveDelay: 500
    };

    this.timing = {
      windowHideDelay: 10,
      appFocusDelay: 50
    };

    this.app = {
      name: 'Prompt Line',
      version: packageJson.version,
      description: 'プロンプトラインアプリ - カーソル位置にテキストを素早く貼り付け'
    };

    this.platform = {
      isMac: process.platform === 'darwin',
      isWindows: process.platform === 'win32',
      isLinux: process.platform === 'linux'
    };

    // Determine log level based on LOG_LEVEL environment variable
    let logLevel: LogLevel = 'info'; // Default to info
    if (process.env.LOG_LEVEL === 'debug') {
      logLevel = 'debug';
    }

    this.logging = {
      level: logLevel,
      enableFileLogging: true,
      maxLogFileSize: 5 * 1024 * 1024,
      maxLogFiles: 3
    };

    // Ensure XDG directories exist (skip in test environment)
    if (process.env.NODE_ENV !== 'test') {
      ensureXdgDirectories(configDir, dataDir, stateDir);
    }
  }

  get<K extends keyof this>(section: K): this[K] {
    return this[section] || {} as this[K];
  }

  getValue(path: string): unknown {
    return path.split('.').reduce((obj, key) => obj && (obj as Record<string, unknown>)[key], this as unknown);
  }

  isDevelopment(): boolean {
    return process.env.NODE_ENV === 'development';
  }

  isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  getInputHtmlPath(): string {
    // In production, HTML file is copied to dist/renderer directory
    // __dirname is dist/config
    return path.join(__dirname, '..', 'renderer', 'input.html');
  }
}

export default new AppConfigClass();