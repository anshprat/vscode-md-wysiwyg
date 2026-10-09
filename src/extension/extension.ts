import * as vscode from 'vscode'

import { RichTextEditorProvider, VIEW_TYPE } from './provider'

const PATTERNS = ['*.md', '*.markdown']

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new RichTextEditorProvider(context), {
      webviewOptions: { retainContextWhenHidden: true, enableFindWidget: true },
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand('mdWysiwyg.openRichText', async (uri?: vscode.Uri) => {
      const target = uri ?? activeUri()
      if (!target) return
      await reopenWith(target, VIEW_TYPE)
      await rememberMode(true)
    }),
    vscode.commands.registerCommand('mdWysiwyg.openSource', async (uri?: vscode.Uri) => {
      const target = uri ?? activeUri()
      if (!target) return
      await reopenWith(target, 'default')
      await rememberMode(false)
    }),
    vscode.commands.registerCommand('mdWysiwyg.openSourceToSide', async (uri?: vscode.Uri) => {
      const target = uri ?? activeUri()
      if (!target) return
      await vscode.commands.executeCommand('vscode.openWith', target, 'default', vscode.ViewColumn.Beside)
    }),
  )
}

export function deactivate(): void {}

/** The file shown in the active editor tab (text or custom editor). */
function activeUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) return input.uri
  return vscode.window.activeTextEditor?.document.uri
}

/**
 * Opens `uri` with another editor in the active group, replacing the tab that
 * showed it before (as "Reopen Editor With..." does). `vscode.openWith`
 * alone would leave both tabs open.
 */
async function reopenWith(uri: vscode.Uri, viewType: string): Promise<void> {
  const group = vscode.window.tabGroups.activeTabGroup
  const column = group.viewColumn
  const isOld = (tab: vscode.Tab) =>
    viewType === VIEW_TYPE
      ? tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()
      : tab.input instanceof vscode.TabInputCustom &&
        tab.input.viewType === VIEW_TYPE &&
        tab.input.uri.toString() === uri.toString()

  // VS Code 1.10x+: replaces the active tab in place and keeps unsaved changes.
  if (group.activeTab && isOld(group.activeTab) && (await hasCommand(REOPEN_WITH))) {
    await vscode.commands.executeCommand(REOPEN_WITH, viewType)
    return
  }

  await vscode.commands.executeCommand('vscode.openWith', uri, viewType, column)
  // Closing a tab with unsaved changes asks to save them, and "Don't Save"
  // would revert the document for the new tab too. Keep the old tab then.
  if (vscode.workspace.textDocuments.some((d) => d.uri.toString() === uri.toString() && d.isDirty)) return
  const old = vscode.window.tabGroups.all.find((g) => g.viewColumn === column)?.tabs.filter(isOld) ?? []
  if (old.length > 0) await vscode.window.tabGroups.close(old, true)
}

/** VS Code's own "Reopen Editor With" with a fixed editor (not in older builds or Cursor). */
const REOPEN_WITH = 'reopenActiveEditorWith'

let commandList: Promise<string[]> | undefined
async function hasCommand(id: string): Promise<boolean> {
  commandList ??= Promise.resolve(vscode.commands.getCommands())
  return (await commandList).includes(id)
}

/**
 * Makes the chosen mode the default for Markdown files, using VS Code's own
 * `workbench.editorAssociations` setting (user scope). Choosing the source
 * editor only removes associations this extension set, never other ones.
 */
async function rememberMode(rich: boolean): Promise<void> {
  if (!vscode.workspace.getConfiguration('mdWysiwyg').get('rememberMode', true)) return
  const config = vscode.workspace.getConfiguration('workbench')
  const current = { ...(config.inspect<Record<string, string>>('editorAssociations')?.globalValue ?? {}) }
  let changed = false
  for (const pattern of PATTERNS) {
    if (rich && current[pattern] !== VIEW_TYPE) {
      current[pattern] = VIEW_TYPE
      changed = true
    } else if (!rich && current[pattern] === VIEW_TYPE) {
      delete current[pattern]
      changed = true
    }
  }
  if (changed) await config.update('editorAssociations', current, vscode.ConfigurationTarget.Global)
}
