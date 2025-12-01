import type { VimMode, VimState } from '../types';
import type { DomManager } from '../dom-manager';

/**
 * VimModeManager
 *
 * Manages Vim-like key bindings and modal editing for the text input.
 * Supports Normal, Insert, Visual, and Visual-Line modes with common Vim commands.
 *
 * Features:
 * - Modal editing: Normal, Insert, Visual, Visual-Line modes
 * - Text manipulation: delete, yank, paste
 * - Cursor movement: h, j, k, l, gg, G
 * - Undo/Redo support
 * - Visual selection with yank/delete/paste
 */
export class VimModeManager {
  private enabled: boolean = false;
  private state: VimState = {
    mode: 'normal',
    yankBuffer: '',
    visualStart: null
  };

  // Undo/Redo stacks
  private undoStack: Array<{ text: string; cursor: number }> = [];
  private redoStack: Array<{ text: string; cursor: number }> = [];
  private maxUndoStack = 100;

  // Pending key for compound commands (like 'gg', 'dd', 'yy')
  private pendingKey: string | null = null;
  private pendingKeyTimeout: NodeJS.Timeout | null = null;
  private readonly PENDING_KEY_TIMEOUT = 1000;

  constructor(
    private domManager: DomManager,
    private onModeChange?: (mode: VimMode) => void,
    private onWindowClose?: () => void,
    private onYank?: (text: string) => void
  ) {}

  /**
   * Enable or disable vim mode
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;

    if (enabled) {
      // Start in normal mode
      this.setMode('normal');
      this.saveState();
    } else {
      // Reset to insert mode (normal text input)
      this.setMode('insert');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getCurrentMode(): VimMode {
    return this.state.mode;
  }

  /**
   * Handle keydown events for vim mode
   * Returns true if the event was handled and should be prevented
   */
  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.enabled) {
      return false;
    }

    const key = event.key;
    const ctrl = event.ctrlKey;
    const shift = event.shiftKey;

    // Handle mode-specific key bindings
    switch (this.state.mode) {
      case 'normal':
        return this.handleNormalMode(key, ctrl, shift, event);
      case 'insert':
        return this.handleInsertMode(key, ctrl, shift);
      case 'visual':
      case 'visual-line':
        return this.handleVisualMode(key, ctrl, shift);
      default:
        return false;
    }
  }

  /**
   * Normal mode key handling
   */
  private handleNormalMode(key: string, ctrl: boolean, shift: boolean, _event: KeyboardEvent): boolean {
    const textarea = this.domManager.textarea;
    if (!textarea) return false;

    // Handle compound keys (gg, dd, yy, etc.)
    if (this.pendingKey) {
      const compound = this.pendingKey + key;
      this.clearPendingKey();

      switch (compound) {
        case 'gg':
          this.moveCursorToStart();
          return true;
        case 'dd':
          this.deleteCurrentLine();
          return true;
        case 'yy':
          this.yankCurrentLine();
          return true;
      }
      return false;
    }

    switch (key) {
      // Mode switches
      case 'i':
        this.setMode('insert');
        return true;

      case 'I':
        this.moveCursorToLineStart();
        this.setMode('insert');
        return true;

      case 'a':
        this.moveCursorRight();
        this.setMode('insert');
        return true;

      case 'A':
        this.moveCursorToLineEnd();
        this.setMode('insert');
        return true;

      case 'o':
        this.insertLineBelow();
        return true;

      case 'O':
        if (shift) {
          this.insertLineAbove();
          return true;
        }
        break;

      case 'v': {
        // Start Visual mode selecting the character under cursor to avoid zero-width (I-beam) state
        this.state.visualStart = textarea.selectionStart;
        const pos = textarea.selectionStart;
        if (pos < textarea.value.length) {
          textarea.setSelectionRange(pos, pos + 1, 'forward');
        } else if (pos > 0) {
          textarea.setSelectionRange(pos - 1, pos, 'backward');
        } else {
          textarea.setSelectionRange(pos, pos);
        }
        this.setMode('visual');
        return true;
      }

      case 'V':
        this.state.visualStart = this.getLineStart(textarea.selectionStart);
        textarea.setSelectionRange(
          this.state.visualStart,
          this.getLineEnd(textarea.selectionStart)
        );
        this.setMode('visual-line');
        return true;

      // Cursor movement
      case 'h':
        this.moveCursorLeft();
        return true;

      case 'j':
        this.moveCursorDown();
        return true;

      case 'k':
        this.moveCursorUp();
        return true;

      case 'l':
        this.moveCursorRight();
        return true;

      case 'Backspace':
        // In normal mode, Backspace should move cursor left without deleting
        this.moveCursorLeft();
        return true;

      case 'G':
        if (shift) {
          this.moveCursorToEnd();
          return true;
        }
        break;

      // Text manipulation
      case 'x':
        this.deleteCharAtCursor();
        return true;

      case 'u':
        this.undo();
        return true;

      case 'U':
        if (shift) {
          this.redo();
          return true;
        }
        break;

      case 'p':
        this.pasteAfterCursor();
        return true;

      case 'P':
        if (shift) {
          this.pasteBeforeCursor();
          return true;
        }
        break;

      case 'q':
        // Close window
        if (this.onWindowClose) {
          this.onWindowClose();
        }
        return true;

      // Compound key triggers
      case 'g':
      case 'd':
      case 'y':
        this.setPendingKey(key);
        return true;
    }

    // Prevent all other default keys in normal mode except special keys
    if (key.length === 1 && !ctrl) {
      return true;
    }

    return false;
  }

  /**
   * Insert mode key handling
   */
  private handleInsertMode(key: string, ctrl: boolean, _shift: boolean): boolean {
    // Esc or Ctrl+[ to exit insert mode
    if (key === 'Escape' || (ctrl && key === '[')) {
      this.saveState();
      this.setMode('normal');
      // Move cursor left to stay on the last inserted character
      this.moveCursorLeft();
      return true;
    }

    // Allow all normal typing in insert mode
    return false;
  }

  /**
   * Visual mode key handling
   */
  private handleVisualMode(key: string, ctrl: boolean, _shift: boolean): boolean {
    const textarea = this.domManager.textarea;
    if (!textarea) return false;

    // Esc or Ctrl+[ to exit visual mode
    if (key === 'Escape' || (ctrl && key === '[')) {
      textarea.setSelectionRange(textarea.selectionStart, textarea.selectionStart);
      this.state.visualStart = null;
      this.setMode('normal');
      return true;
    }

    // Support compound key 'gg' and 'G' in visual modes
    if (this.pendingKey) {
      const compound = this.pendingKey + key;
      this.clearPendingKey();
      if (compound === 'gg') {
        // Extend selection to file start
        const anchor = this.state.visualStart ?? textarea.selectionStart;
        const target = 0;
        if (this.state.mode === 'visual-line') {
          this.setSelectionWithDirection(anchor, 0);
        } else {
          this.setSelectionWithDirection(anchor, target);
        }
        return true;
      }
      // Unknown compound — ignore
    }

    switch (key) {
      case 'g':
        this.setPendingKey('g');
        return true;

      case 'G':
        if (_shift) { /* noop - key already uppercase */ }
        {
          const anchor = this.state.visualStart ?? textarea.selectionStart;
          const endPos = textarea.value.length;
          if (this.state.mode === 'visual-line') {
            // Extend to end of last line
            const target = this.getLineEnd(endPos);
            this.setSelectionWithDirection(anchor, target);
          } else {
            this.setSelectionWithDirection(anchor, endPos);
          }
        }
        return true;
      case 'y':
        this.yankSelection();
        textarea.setSelectionRange(textarea.selectionStart, textarea.selectionStart);
        this.state.visualStart = null;
        this.setMode('normal');
        return true;

      case 'd':
        this.deleteSelection();
        this.state.visualStart = null;
        this.setMode('normal');
        return true;

      case 'p':
        this.replaceSelectionWithYank();
        this.state.visualStart = null;
        this.setMode('normal');
        return true;

      // Cursor movement in visual mode (extends selection)
      case 'h':
        this.extendSelectionLeft();
        return true;

      case 'l':
        this.extendSelectionRight();
        return true;

      case 'j':
        if (this.state.mode === 'visual-line') {
          this.extendSelectionDownLine();
        } else {
          this.extendSelectionDown();
        }
        return true;

      case 'k':
        if (this.state.mode === 'visual-line') {
          this.extendSelectionUpLine();
        } else {
          this.extendSelectionUp();
        }
        return true;
    }

    return false;
  }

  /**
   * Set the current vim mode
   */
  private setMode(mode: VimMode): void {
    this.state.mode = mode;

    // Update textarea data attribute for CSS styling
    const textarea = this.domManager.textarea;
    if (textarea) {
      textarea.setAttribute('data-vim-mode', mode);
    }

    // Update cursor appearance based on mode
    this.updateCursorAppearance(mode);

    if (this.onModeChange) {
      this.onModeChange(mode);
    }
  }

  /**
   * Update cursor appearance based on vim mode
   * Normal mode: Block cursor (select current character)
   * Insert mode: Default I-beam cursor
   * Visual modes: Already have selection
   */
  private updateCursorAppearance(mode: VimMode): void {
    const textarea = this.domManager.textarea;
    if (!textarea) return;

    if (mode === 'normal') {
      // In normal mode, select the character at cursor to create block cursor effect
      const pos = textarea.selectionStart;
      if (pos < textarea.value.length) {
        textarea.setSelectionRange(pos, pos + 1);
      } else if (textarea.value.length > 0) {
        // At end of text, select last character
        textarea.setSelectionRange(pos - 1, pos);
      }
    } else if (mode === 'insert') {
      // Collapse any selection to caret so typing doesn't overwrite
      const pos = textarea.selectionStart;
      textarea.setSelectionRange(pos, pos);
      // caret-color becomes visible via CSS since only normal mode hides it
    }
    // For visual modes, keep current selection as-is
  }

  /**
   * Pending key management for compound commands
   */
  private setPendingKey(key: string): void {
    this.pendingKey = key;

    if (this.pendingKeyTimeout) {
      clearTimeout(this.pendingKeyTimeout);
    }

    this.pendingKeyTimeout = setTimeout(() => {
      this.pendingKey = null;
      this.pendingKeyTimeout = null;
    }, this.PENDING_KEY_TIMEOUT);
  }

  private clearPendingKey(): void {
    if (this.pendingKeyTimeout) {
      clearTimeout(this.pendingKeyTimeout);
      this.pendingKeyTimeout = null;
    }
    this.pendingKey = null;
  }

  /**
   * Undo/Redo management
   */
  private saveState(): void {
    const textarea = this.domManager.textarea;
    if (!textarea) return;

    const state = {
      text: textarea.value,
      cursor: textarea.selectionStart
    };

    // Add to undo stack
    this.undoStack.push(state);

    // Limit stack size
    if (this.undoStack.length > this.maxUndoStack) {
      this.undoStack.shift();
    }

    // Clear redo stack on new change
    this.redoStack = [];
  }

  private undo(): void {
    if (this.undoStack.length === 0) {
      return;
    }

    const textarea = this.domManager.textarea;
    if (!textarea) return;

    // Save current state to redo stack
    this.redoStack.push({
      text: textarea.value,
      cursor: textarea.selectionStart
    });

    // Restore previous state
    const state = this.undoStack.pop();
    if (!state) return;

    textarea.value = state.text;
    textarea.setSelectionRange(state.cursor, state.cursor);

    // Update character count
    this.domManager.updateCharCount();
  }

  private redo(): void {
    if (this.redoStack.length === 0) {
      return;
    }

    const textarea = this.domManager.textarea;
    if (!textarea) return;

    // Save current state to undo stack
    this.undoStack.push({
      text: textarea.value,
      cursor: textarea.selectionStart
    });

    // Restore redo state
    const state = this.redoStack.pop();
    if (!state) return;

    textarea.value = state.text;
    textarea.setSelectionRange(state.cursor, state.cursor);

    // Update character count
    this.domManager.updateCharCount();
  }

  /**
   * Cursor movement helpers
   */
  private moveCursorLeft(): void {
    const textarea = this.domManager.textarea;
    if (!textarea) return;

    const newPos = Math.max(0, textarea.selectionStart - 1);
    textarea.setSelectionRange(newPos, newPos);
    this.updateCursorAppearance(this.state.mode);
  }

  private moveCursorRight(): void {
    const textarea = this.domManager.textarea;
    if (!textarea) return;

    const newPos = Math.min(textarea.value.length, textarea.selectionStart + 1);
    textarea.setSelectionRange(newPos, newPos);
    this.updateCursorAppearance(this.state.mode);
  }

  private moveCursorUp(): void {
    const textarea = this.domManager.textarea;
    if (!textarea) return;

    const pos = textarea.selectionStart;
    const lineStart = this.getLineStart(pos);
    if (lineStart === 0) {
      return; // Already on first line
    }
    const prevLineEnd = lineStart - 1; // index of '\n'
    const prevLineStart = this.getLineStart(prevLineEnd);
    const prevLineLen = prevLineEnd - prevLineStart;
    const col = pos - lineStart;
    const targetCol = Math.max(0, Math.min(col, Math.max(0, prevLineLen - 1)));
    const newPos = prevLineStart + targetCol;
    textarea.setSelectionRange(newPos, newPos);
    this.updateCursorAppearance(this.state.mode);
  }

  private moveCursorDown(): void {
    const textarea = this.domManager.textarea;
    if (!textarea) return;

    const text = textarea.value;
    const pos = textarea.selectionStart;
    const lineStart = this.getLineStart(pos);
    const lineEnd = this.getLineEnd(pos);
    if (lineEnd >= text.length) {
      return; // Already on last line
    }
    const nextLineStart = lineEnd + 1;
    const nextLineEnd = this.getLineEnd(nextLineStart);
    const nextLen = nextLineEnd - nextLineStart;
    const col = pos - lineStart;
    const targetCol = Math.max(0, Math.min(col, Math.max(0, nextLen - 1)));
    const newPos = nextLineStart + targetCol;
    textarea.setSelectionRange(newPos, newPos);
    this.updateCursorAppearance(this.state.mode);
  }

  private moveCursorToStart(): void {
    const textarea = this.domManager.textarea;
    if (!textarea) return;

    textarea.setSelectionRange(0, 0);
    this.updateCursorAppearance(this.state.mode);
  }

  private moveCursorToEnd(): void {
    const textarea = this.domManager.textarea;
    if (!textarea) return;

    const len = textarea.value.length;
    textarea.setSelectionRange(len, len);
    this.updateCursorAppearance(this.state.mode);
  }

  private moveCursorToLineStart(): void {
    const textarea = this.domManager.textarea;
    if (!textarea) return;

    const lineStart = this.getLineStart(textarea.selectionStart);
    textarea.setSelectionRange(lineStart, lineStart);
    this.updateCursorAppearance(this.state.mode);
  }

  private moveCursorToLineEnd(): void {
    const textarea = this.domManager.textarea;
    if (!textarea) return;

    const lineEnd = this.getLineEnd(textarea.selectionStart);
    textarea.setSelectionRange(lineEnd, lineEnd);
    this.updateCursorAppearance(this.state.mode);
  }

  /**
   * Text manipulation helpers
   */
  private deleteCharAtCursor(): void {
    this.saveState();

    const textarea = this.domManager.textarea;
    if (!textarea) return;

    const pos = textarea.selectionStart;

    if (pos < textarea.value.length) {
      const newText = textarea.value.slice(0, pos) + textarea.value.slice(pos + 1);
      textarea.value = newText;
      textarea.setSelectionRange(pos, pos);
      this.domManager.updateCharCount();
    }
  }

  private deleteCurrentLine(): void {
    this.saveState();

    const textarea = this.domManager.textarea;
    if (!textarea) return;

    const lineStart = this.getLineStart(textarea.selectionStart);
    const lineEnd = this.getLineEnd(textarea.selectionStart);

    // Yank the line (including newline)
    const nextLineEnd = lineEnd < textarea.value.length ? lineEnd + 1 : lineEnd;
    this.state.yankBuffer = textarea.value.slice(lineStart, nextLineEnd);

    // Copy to system clipboard
    if (this.onYank) {
      this.onYank(this.state.yankBuffer);
    }

    // Delete the line
    const newText = textarea.value.slice(0, lineStart) + textarea.value.slice(nextLineEnd);
    textarea.value = newText;
    textarea.setSelectionRange(lineStart, lineStart);
    this.domManager.updateCharCount();
  }

  private yankCurrentLine(): void {
    const textarea = this.domManager.textarea;
    if (!textarea) return;

    const lineStart = this.getLineStart(textarea.selectionStart);
    const lineEnd = this.getLineEnd(textarea.selectionStart);

    // Include newline if not last line
    const nextLineEnd = lineEnd < textarea.value.length ? lineEnd + 1 : lineEnd;
    this.state.yankBuffer = textarea.value.slice(lineStart, nextLineEnd);

    // Copy to system clipboard
    if (this.onYank) {
      this.onYank(this.state.yankBuffer);
    }
  }

  private yankSelection(): void {
    const textarea = this.domManager.textarea;
    if (!textarea) return;

    this.state.yankBuffer = textarea.value.slice(
      Math.min(textarea.selectionStart, textarea.selectionEnd),
      Math.max(textarea.selectionStart, textarea.selectionEnd)
    );

    // Copy to system clipboard
    if (this.onYank) {
      this.onYank(this.state.yankBuffer);
    }
  }

  private deleteSelection(): void {
    this.saveState();

    const textarea = this.domManager.textarea;
    if (!textarea) return;

    const start = Math.min(textarea.selectionStart, textarea.selectionEnd);
    const end = Math.max(textarea.selectionStart, textarea.selectionEnd);

    // Yank before delete
    this.state.yankBuffer = textarea.value.slice(start, end);

    // Copy to system clipboard
    if (this.onYank) {
      this.onYank(this.state.yankBuffer);
    }

    // Delete
    textarea.value = textarea.value.slice(0, start) + textarea.value.slice(end);
    textarea.setSelectionRange(start, start);
    this.domManager.updateCharCount();
  }

  private pasteAfterCursor(): void {
    (async () => {
      const clip = await this.readClipboardText();
      const text = (clip && clip.length > 0) ? clip : this.state.yankBuffer;
      if (!text) return;

      this.saveState();

      const textarea = this.domManager.textarea;
      if (!textarea) return;

      const pos = Math.min(textarea.value.length, textarea.selectionStart + 1);
      textarea.value = textarea.value.slice(0, pos) + text + textarea.value.slice(pos);
      textarea.setSelectionRange(pos, pos);
      this.domManager.updateCharCount();
    })().catch(() => void 0);
  }

  private pasteBeforeCursor(): void {
    (async () => {
      const clip = await this.readClipboardText();
      const text = (clip && clip.length > 0) ? clip : this.state.yankBuffer;
      if (!text) return;

      this.saveState();

      const textarea = this.domManager.textarea;
      if (!textarea) return;

      const pos = textarea.selectionStart;
      textarea.value = textarea.value.slice(0, pos) + text + textarea.value.slice(pos);
      textarea.setSelectionRange(pos, pos);
      this.domManager.updateCharCount();
    })().catch(() => void 0);
  }

  private replaceSelectionWithYank(): void {
    (async () => {
      const clip = await this.readClipboardText();
      const text = (clip && clip.length > 0) ? clip : this.state.yankBuffer;
      if (!text) return;

      this.saveState();

      const textarea = this.domManager.textarea;
      if (!textarea) return;

      const start = Math.min(textarea.selectionStart, textarea.selectionEnd);
      const end = Math.max(textarea.selectionStart, textarea.selectionEnd);

      textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
      textarea.setSelectionRange(start, start);
      this.domManager.updateCharCount();
    })().catch(() => void 0);
  }

  private async readClipboardText(): Promise<string | null> {
    try {
      if (navigator?.clipboard?.readText) {
        const t = await navigator.clipboard.readText();
        return t ?? '';
      }
    } catch {
      // Ignore errors and fall back to yank buffer
    }
    return null;
  }

  /**
   * Insert new line below current line and enter insert mode
   */
  private insertLineBelow(): void {
    this.saveState();

    const textarea = this.domManager.textarea;
    if (!textarea) return;

    const lineEnd = this.getLineEnd(textarea.selectionStart);
    const newPos = lineEnd + 1;

    // Insert newline at end of current line
    textarea.value = textarea.value.slice(0, lineEnd) + '\n' + textarea.value.slice(lineEnd);
    textarea.setSelectionRange(newPos, newPos);
    this.domManager.updateCharCount();

    // Enter insert mode
    this.setMode('insert');
  }

  /**
   * Insert new line above current line and enter insert mode
   */
  private insertLineAbove(): void {
    this.saveState();

    const textarea = this.domManager.textarea;
    if (!textarea) return;

    const lineStart = this.getLineStart(textarea.selectionStart);

    // Insert newline before current line
    textarea.value = textarea.value.slice(0, lineStart) + '\n' + textarea.value.slice(lineStart);
    textarea.setSelectionRange(lineStart, lineStart);
    this.domManager.updateCharCount();

    // Enter insert mode
    this.setMode('insert');
  }

  /**
   * Visual mode selection helpers
   */
  private extendSelectionLeft(): void {
    const textarea = this.domManager.textarea;
    if (!textarea || this.state.visualStart === null) return;

    const { anchor, active } = this.getVisualAnchorAndActive();
    const newActive = Math.max(0, active - 1);
    this.setSelectionWithDirection(anchor, newActive);
  }

  private extendSelectionRight(): void {
    const textarea = this.domManager.textarea;
    if (!textarea || this.state.visualStart === null) return;

    const { anchor, active } = this.getVisualAnchorAndActive();
    const newActive = Math.min(textarea.value.length, active + 1);
    this.setSelectionWithDirection(anchor, newActive);
  }

  private extendSelectionUp(): void {
    const textarea = this.domManager.textarea;
    if (!textarea || this.state.visualStart === null) return;

    const { anchor, active } = this.getVisualAnchorAndActive();
    const currentPos = active;
    const currentLineStart = this.getLineStart(currentPos);
    if (currentLineStart === 0) return;
    const prevLineEnd = currentLineStart - 1;
    const prevLineStart = this.getLineStart(prevLineEnd);
    const prevLen = prevLineEnd - prevLineStart;
    const col = currentPos - currentLineStart;
    const targetCol = Math.max(0, Math.min(col, prevLen));
    const newActive = prevLineStart + targetCol;
    this.setSelectionWithDirection(anchor, newActive);
  }

  private extendSelectionDown(): void {
    const textarea = this.domManager.textarea;
    if (!textarea || this.state.visualStart === null) return;

    const { anchor, active } = this.getVisualAnchorAndActive();
    const currentPos = active;
    const currentLineStart = this.getLineStart(currentPos);
    const currentLineEnd = this.getLineEnd(currentPos);
    if (currentLineEnd >= textarea.value.length) return;
    const nextLineStart = currentLineEnd + 1;
    const nextLineEnd = this.getLineEnd(nextLineStart);
    const nextLen = nextLineEnd - nextLineStart;
    const col = currentPos - currentLineStart;
    const targetCol = Math.max(0, Math.min(col, nextLen));
    const newActive = nextLineStart + targetCol;
    this.setSelectionWithDirection(anchor, newActive);
  }

  private extendSelectionUpLine(): void {
    const textarea = this.domManager.textarea;
    if (!textarea || this.state.visualStart === null) return;

    const { anchor, active } = this.getVisualAnchorAndActive();
    const currentLineStart = this.getLineStart(active);
    if (currentLineStart > 0) {
      const prevLineEnd = currentLineStart - 1;
      this.setSelectionWithDirection(anchor, prevLineEnd);
    }
  }

  private extendSelectionDownLine(): void {
    const textarea = this.domManager.textarea;
    if (!textarea || this.state.visualStart === null) return;

    const { anchor, active } = this.getVisualAnchorAndActive();
    const currentLineEnd = this.getLineEnd(active);
    if (currentLineEnd < textarea.value.length) {
      const nextLineEnd = this.getLineEnd(currentLineEnd + 1);
      this.setSelectionWithDirection(anchor, nextLineEnd);
    }
  }

  /**
   * Ensure correct selection direction while extending in visual modes.
   */
  private setSelectionWithDirection(anchor: number, active: number): void {
    const textarea = this.domManager.textarea;
    if (!textarea) return;
    if (active < anchor) {
      textarea.setSelectionRange(active, anchor, 'backward');
    } else {
      textarea.setSelectionRange(anchor, active, 'forward');
    }
  }

  private getVisualAnchorAndActive(): { anchor: number; active: number } {
    const textarea = this.domManager.textarea;
    if (!textarea) return { anchor: 0, active: 0 };
    const anchor = this.state.visualStart ?? textarea.selectionStart;
    const start = Math.min(textarea.selectionStart, textarea.selectionEnd);
    const end = Math.max(textarea.selectionStart, textarea.selectionEnd);
    let active = end;
    if (anchor === end) active = start;
    if (anchor !== start && anchor !== end) {
      active = end;
    }
    return { anchor, active };
  }

  /**
   * Helper methods to get line boundaries
   */
  private getLineStart(pos: number): number {
    const textarea = this.domManager.textarea;
    if (!textarea) return 0;

    const text = textarea.value;
    let start = pos;

    while (start > 0 && text[start - 1] !== '\n') {
      start--;
    }

    return start;
  }

  private getLineEnd(pos: number): number {
    const textarea = this.domManager.textarea;
    if (!textarea) return 0;

    const text = textarea.value;
    let end = pos;

    while (end < text.length && text[end] !== '\n') {
      end++;
    }

    return end;
  }

  /**
   * Cleanup method
   */
  cleanup(): void {
    if (this.pendingKeyTimeout) {
      clearTimeout(this.pendingKeyTimeout);
      this.pendingKeyTimeout = null;
    }
  }
}
