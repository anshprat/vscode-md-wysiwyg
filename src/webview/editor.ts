/**
 * The WYSIWYG editor: Milkdown/Crepe with GitHub-flavored Markdown, plus the
 * Markdown merge that keeps untouched blocks byte-for-byte unchanged.
 */
import { languages } from '@codemirror/language-data'
import { CrepeBuilder } from '@milkdown/crepe/builder'
import { blockEdit } from '@milkdown/crepe/feature/block-edit'
import { codeMirror } from '@milkdown/crepe/feature/code-mirror'
import { cursor } from '@milkdown/crepe/feature/cursor'
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip'
import { listItem } from '@milkdown/crepe/feature/list-item'
import { placeholder } from '@milkdown/crepe/feature/placeholder'
import { table } from '@milkdown/crepe/feature/table'
import { toolbar } from '@milkdown/crepe/feature/toolbar'
import { topBar } from '@milkdown/crepe/feature/top-bar'
import { imageInlineComponent, inlineImageConfig } from '@milkdown/kit/component/image-inline'
import { commandsCtx, editorViewCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { uploadConfig } from '@milkdown/kit/plugin/upload'
import { insertImageCommand } from '@milkdown/kit/preset/commonmark'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { $remark, replaceAll } from '@milkdown/kit/utils'

import { MarkdownSession } from '../markdown/session'
import { githubCodeTheme } from './code-theme'
import { createImageResolver, type ImageContext } from './images'

const IMAGE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19 5V19H5V5H19ZM19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM14.14 11.86L11.14 15.73L9 13.14L6 17H18L14.14 11.86Z"/></svg>`

/**
 * Milkdown's image node requires a string title, but Markdown images without
 * a title parse with `title: null`. Normalize before Milkdown sees the tree.
 */
const remarkImageTitles = $remark('gmwImageTitles', () => () => (tree) => {
  const walk = (node: { type: string; title?: unknown; children?: unknown[] }) => {
    if (node.type === 'image' && node.title == null) node.title = ''
    node.children?.forEach((c) => walk(c as typeof node))
  }
  walk(tree as Parameters<typeof walk>[0])
})

const insertImage = (ctx: import('@milkdown/kit/ctx').Ctx) =>
  ctx.get(commandsCtx).call(insertImageCommand.key, { src: '', alt: '', title: '' })

export interface OpenOptions {
  /** Element the editor renders into. */
  root: HTMLElement
  /** Current content of the file. */
  fileText: string
  images: ImageContext
  /** Called with the full new file content after the user edits. */
  onFileChange: (text: string) => void
  onNotice: (message: string, level: 'info' | 'error') => void
  /** Stores a pasted or dropped image and returns its Markdown link. */
  saveImage: (file: File) => Promise<string>
  /** Called when the user follows a link (Cmd/Ctrl+click). */
  openLink: (href: string) => void
  /** Debounce for onFileChange, in ms. */
  debounceMs?: number
}

export interface RichEditor {
  /** Pushes any pending change to onFileChange right away. */
  flush(): void
  /** Returns the pending file content without sending it, or null if nothing changed. */
  takePending(): string | null
  /** Shows new file content after a change made outside the editor. */
  load(fileText: string): void
  focus(): void
  destroy(): Promise<void>
}

export async function openEditor(opts: OpenOptions): Promise<RichEditor> {
  let session = new MarkdownSession(opts.fileText)
  /** File content the host has (last sent or loaded). */
  let lastFile = opts.fileText
  const resolveImage = createImageResolver(opts.images)

  const mount = document.createElement('div')
  mount.className = 'gmw-milkdown'
  opts.root.append(mount)

  const crepe = new CrepeBuilder({ root: mount, defaultValue: session.body })

  const upload = async (file: File): Promise<string | null> => {
    try {
      return await opts.saveImage(file)
    } catch (err) {
      opts.onNotice(`Could not save the image: ${(err as Error).message}`, 'error')
      return null
    }
  }

  crepe.editor
    .config((ctx) => {
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({ ...prev, ...session.style }))
      // Pasted and dropped images are saved as files next to the document,
      // instead of Crepe's default blob:/data: URLs.
      ctx.update(uploadConfig.key, (prev) => ({
        ...prev,
        uploader: async (files, schema) => {
          const nodes: ProseNode[] = []
          for (const file of Array.from(files)) {
            if (!file.type.startsWith('image/')) continue
            const src = await upload(file)
            const alt = file.name.replace(/\.[^.]+$/, '')
            const node = src && schema.nodes.image.createAndFill({ src, alt, title: '' })
            if (node) nodes.push(node)
          }
          return nodes
        },
      }))
      ctx.update(inlineImageConfig.key, (prev) => ({
        ...prev,
        imageIcon: IMAGE_ICON,
        uploadButton: 'Upload',
        confirmButton: 'Insert',
        uploadPlaceholderText: 'Paste an image link',
        proxyDomURL: resolveImage,
        onUpload: async (file: File) => {
          const src = await upload(file)
          if (!src) throw new Error('Image upload failed')
          return src
        },
      }))
    })
    .use(remarkImageTitles)
    .use(imageInlineComponent)

  // Crepe's own image feature ("image block") stores the image size in the alt
  // text, which would rewrite `![Screenshot](a.png)` as `![1.00](a.png)`.
  // Plain inline images keep Markdown as GitHub expects it.
  crepe
    .addFeature(cursor)
    .addFeature(listItem)
    .addFeature(linkTooltip)
    .addFeature(table)
    .addFeature(toolbar)
    .addFeature(topBar, {
      buildTopBar: (builder) =>
        builder.getGroup('insert').addItem('image', { icon: IMAGE_ICON, active: () => false, onRun: insertImage }),
    })
    .addFeature(blockEdit, {
      buildMenu: (builder) =>
        builder.getGroup('advanced').addItem('image', { label: 'Image', icon: IMAGE_ICON, onRun: insertImage }),
    })
    .addFeature(placeholder, { text: 'Type / for commands', mode: 'block' })
    .addFeature(codeMirror, { languages, theme: githubCodeTheme })

  let pending: ReturnType<typeof setTimeout> | null = null
  let ready = false

  /** Full file content for what the editor shows now, or null if the host already has it. */
  const take = (): string | null => {
    if (pending) clearTimeout(pending)
    pending = null
    if (!ready) return null
    const file = session.toFile(crepe.getMarkdown())
    if (file === lastFile) return null
    lastFile = file
    return file
  }
  const push = () => {
    const file = take()
    if (file !== null) opts.onFileChange(file)
  }
  crepe.on((listener) => {
    listener.markdownUpdated(() => {
      if (!ready) return
      if (pending) clearTimeout(pending)
      pending = setTimeout(push, opts.debounceMs ?? 150)
    })
  })

  await crepe.create()
  session.setBase(crepe.getMarkdown())
  ready = true

  // Render content with GitHub's Markdown stylesheet.
  crepe.editor.action((ctx) => ctx.get(editorViewCtx).dom.classList.add('markdown-body'))

  // VS Code forwards Cmd/Ctrl+Z to its own Undo command, which then sends
  // `execCommand('undo')` back into the webview. ProseMirror already handled
  // the key, so stop it here to avoid undoing twice.
  mount.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
      e.stopPropagation()
    }
  })

  // VS Code opens every clicked link in the browser. In an editor a click
  // places the cursor; Cmd/Ctrl+click follows the link. ProseMirror must not
  // see that mousedown, or it selects the whole paragraph.
  const followsLink = (e: MouseEvent) =>
    (e.metaKey || e.ctrlKey) && !!(e.target as Element | null)?.closest?.('.ProseMirror a[href]')
  mount.addEventListener(
    'mousedown',
    (e) => {
      if (!followsLink(e)) return
      e.preventDefault()
      e.stopPropagation()
    },
    true,
  )
  mount.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href]')
    if (!a) return
    e.preventDefault()
    e.stopPropagation()
    if (e.metaKey || e.ctrlKey || a.closest('.milkdown-link-preview')) opts.openLink(a.getAttribute('href')!)
  })

  return {
    flush: push,
    takePending: take,
    load(fileText: string) {
      if (pending) clearTimeout(pending)
      pending = null
      ready = false
      const scroll = document.scrollingElement?.scrollTop ?? 0
      session = new MarkdownSession(fileText)
      lastFile = fileText
      crepe.editor.action(replaceAll(session.body, true))
      session.setBase(crepe.getMarkdown())
      document.scrollingElement?.scrollTo({ top: scroll })
      ready = true
    },
    focus: () => crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus()),
    destroy: async () => {
      if (pending) clearTimeout(pending)
      ready = false
      await crepe.destroy()
      mount.remove()
    },
  }
}
