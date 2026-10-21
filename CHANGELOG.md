# Changelog

## 1.0.0

- Rich-text (WYSIWYG) editor for `.md` and `.markdown` files, as a VS Code custom text editor. Works in VS Code and Cursor.
- GitHub Markdown styles, light and dark, following the color theme.
- Minimal diffs: untouched blocks keep their exact Markdown; new text follows the file's style.
- Keeps front matter, HTML blocks, link reference definitions, line endings and the trailing newline.
- Remembers the last mode (rich text or source) through `workbench.editorAssociations`.
- Pasted and dropped images are saved as files next to the document.
- Cmd/Ctrl+click follows links; relative links open in the editor.
- Pending edits are written before every save.
