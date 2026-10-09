# Markdown WYSIWYG

Edit Markdown files in a rich-text (WYSIWYG) editor in VS Code and Cursor. The file stays plain Markdown, and blocks you do not touch keep their exact text.

This is the editor from the [GitHub Markdown WYSIWYG](https://github.com/anshprat/github-md-wysiwyg) Chrome extension, as a VS Code custom editor.

## Features

- Opens `.md` and `.markdown` files in a rich-text editor. Switch between rich text and source with one click.
- Renders the document with GitHub's own Markdown styles. Light and dark colors follow the VS Code color theme.
- Supports headings, bold/italic/strikethrough, links, lists, task lists, tables, quotes, code blocks with syntax highlighting, and images. It has a formatting bar, a selection toolbar and a `/` command menu.
- **Minimal diffs.** Blocks you do not touch keep their exact original Markdown, so a one-word edit gives a one-line diff. New text follows the file's existing style (`-` vs `*` bullets, `_` vs `*` emphasis, and so on).
- Keeps front matter, HTML blocks, link reference definitions, line endings and the trailing newline.
- Remembers your last mode. If you used rich text last, the next Markdown file opens in rich text.
- Saves pasted and dropped images as files next to the Markdown file, and links them.
- Shows relative images from the workspace.
- Cmd+click (Ctrl+click on Windows and Linux) follows a link. Relative links open the linked file.
- Works with VS Code's save, undo/redo, hot exit, find (Cmd+F), auto save and Source Control. The Markdown file is the only source of truth.
- Changes from other places (the source editor, git, formatters, other tools) show up in the rich-text editor at once.
- Also runs in VS Code for the Web (vscode.dev, github.dev).

## Install

### From a `.vsix` file

1. Run `npm install && npm run package`. This makes `md-wysiwyg-<version>.vsix`.
2. In VS Code or Cursor, open the Command Palette and run **Extensions: Install from VSIX...**.
3. Select the `.vsix` file.

From a terminal:

```bash
code --install-extension md-wysiwyg-1.0.0.vsix     # VS Code
cursor --install-extension md-wysiwyg-1.0.0.vsix   # Cursor
```

### From a marketplace

Not published yet. VS Code uses the Visual Studio Marketplace. Cursor uses Open VSX. See [Publishing](#publishing).

## Usage

1. Open a Markdown file.
2. Click **Open in Rich Text Editor** (pencil icon) in the editor title bar.
3. Edit the document. Type `/` for the block menu, or select text for the formatting toolbar.
4. Save with Cmd+S (Ctrl+S) as usual.

Click **Open Markdown Source** (`</>` icon) to go back to the source. **Open Markdown Source to the Side** (in the `...` menu) shows both editors at the same time. They stay in sync.

Other ways to open the rich-text editor:

- Right-click a Markdown file in the Explorer and select **Open in Rich Text Editor**.
- Run **Reopen Editor With...** and select **Markdown Rich Text**.

### Cursor

Cursor shows extension buttons in the editor's `...` menu, not in the title bar. To show them in the title bar, add this to your settings:

```json
"cursor.general.pinnedTitleActions": ["mdWysiwyg.openRichText", "mdWysiwyg.openSource"]
```

The Command Palette commands work without this setting.

## Settings

| Setting | Default | Description |
|---|---|---|
| `mdWysiwyg.rememberMode` | `true` | Open Markdown files in the mode you used last. It sets or removes `workbench.editorAssociations` for `*.md` and `*.markdown` in your user settings. |
| `mdWysiwyg.imageFolder` | `""` | Folder for pasted and dropped images, relative to the Markdown file. Empty means the file's own folder. |
| `mdWysiwyg.colors` | `"github"` | `github`: GitHub's light or dark colors. `editor`: the background and text colors of your color theme. |

## How it works

```
VS Code / Cursor
├── TextDocument (the .md file)         ← the only source of truth
├── extension host (dist/extension.js)  applies minimal text edits, saves images, opens links
└── webview (dist/webview.js)           Milkdown/Crepe editor + Markdown merge
```

- The extension is a [custom text editor](https://code.visualstudio.com/api/extension-guides/custom-editors). VS Code owns the document, so save, undo, dirty state, hot exit and Source Control work as for any text file.
- After each edit, the webview sends the new file content. The extension host replaces only the changed range of the document.
- `src/markdown/preserve.ts` aligns the editor's output with the original file block by block. It reuses the original text of every unchanged block. This keeps diffs small, even though WYSIWYG editors normalize Markdown.
- Before a save, the extension gets any edit the webview has not sent yet, so a fast Cmd+S never loses the last keystrokes.

## Limitations

- HTML blocks show as raw HTML text. They are kept unchanged unless you edit them.
- Math (`$...$`) and MDX files are not supported in rich-text mode.
- Editing one item in a list rewrites that list's Markdown (other blocks stay unchanged).
- Cursor, and VS Code versions without the `reopenActiveEditorWith` command: if the file has unsaved changes, switching modes opens the other editor in a new tab. The old tab stays open, because closing it would ask to save. Save first to switch in place.

## Development

```bash
npm install
npm run build          # bundle into dist/
npm run watch          # rebuild on change
npm run typecheck
npm test               # unit tests (Markdown merge, text edits)
npm run test:webview   # the editor UI in Chromium, with a mock VS Code API
npm run test:vscode    # end-to-end in a real VS Code window (downloads VS Code into .vscode-test/)
VSCODE_EXECUTABLE=/Applications/Cursor.app/Contents/MacOS/Cursor npm run test:vscode   # same, in Cursor
npm run test:web       # smoke test in VS Code for the Web (vscode.dev, github.dev)
```

To debug, open this folder in VS Code and press F5 (**Run Extension**).

## Packaging

```bash
npm run package
```

This builds the extension and creates `md-wysiwyg-<version>.vsix`.

## Publishing

1. Create a publisher (`anshprat`) at the [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage) and get a Personal Access Token.
2. Run `npx vsce publish` to publish to the Visual Studio Marketplace (VS Code).
3. Create a namespace at [Open VSX](https://open-vsx.org) and get a token.
4. Run `npx ovsx publish md-wysiwyg-<version>.vsix -p <token>` to publish to Open VSX (Cursor, VSCodium, Windsurf).

## Privacy

This extension does not collect, store, or transmit any user data. Web images in your documents load from their own servers, as in VS Code's Markdown preview.
