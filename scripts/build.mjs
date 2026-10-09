import { readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'

import * as esbuild from 'esbuild'

const watch = process.argv.includes('--watch')
const outdir = 'dist'
const require = createRequire(import.meta.url)

rmSync(outdir, { recursive: true, force: true })

/**
 * `gmw:github-markdown.css`: GitHub's light and dark Markdown styles, each
 * scoped to the matching VS Code theme kind (VS Code sets a class on <body>).
 */
const githubMarkdownCss = {
  name: 'github-markdown-css',
  setup(build) {
    build.onResolve({ filter: /^gmw:github-markdown\.css$/ }, (args) => ({ path: args.path, namespace: 'gmw' }))
    build.onLoad({ filter: /.*/, namespace: 'gmw' }, () => {
      const scoped = (file, scope) =>
        readFileSync(require.resolve(`github-markdown-css/${file}`), 'utf8').replaceAll(
          '.markdown-body',
          `${scope} .markdown-body`,
        )
      return {
        loader: 'css',
        contents:
          scoped('github-markdown-light.css', 'body:is(.vscode-light, .vscode-high-contrast-light)') +
          scoped('github-markdown-dark.css', 'body:is(.vscode-dark, .vscode-high-contrast)'),
      }
    })
  },
}

/**
 * Fixes a Milkdown bug: a new list item restores the selection it saw at
 * mount time one animation frame later. Text typed within that frame (fast
 * typing after Enter, automation) jumps to the start of the item. Skip the
 * restore when the document changed in between.
 */
const listItemCursorFix = {
  name: 'list-item-cursor-fix',
  setup(build) {
    build.onLoad({ filter: /@milkdown[\\/]components[\\/]lib[\\/]list-item-block[\\/]index\.js$/ }, (args) => {
      let code = readFileSync(args.path, 'utf8')
      const patches = [
        ['const { anchor, head } = view.state.selection;', 'const { anchor, head } = view.state.selection;\nconst mountedDoc = view.state.doc;'],
        ['if (anchor > docSize || head > docSize) return;', 'if (state.doc !== mountedDoc || anchor > docSize || head > docSize) return;'],
      ]
      for (const [from, to] of patches) {
        if (!code.includes(from)) throw new Error(`list-item-cursor-fix: pattern not found in ${args.path}: ${from}`)
        code = code.replace(from, to)
      }
      return { contents: code, loader: 'js' }
    })
  },
}

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
}

const builds = [
  // Extension host, desktop (Node).
  {
    ...common,
    entryPoints: { extension: 'src/extension/extension.ts' },
    outdir,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
  },
  // Extension host, web (vscode.dev, github.dev).
  {
    ...common,
    entryPoints: { extension: 'src/extension/extension.ts' },
    outdir: `${outdir}/web`,
    platform: 'browser',
    format: 'cjs',
    target: 'es2022',
    external: ['vscode'],
  },
  // Webview (editor UI).
  {
    ...common,
    entryPoints: { webview: 'src/webview/index.ts' },
    outdir,
    platform: 'browser',
    format: 'iife',
    target: 'chrome120',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [githubMarkdownCss, listItemCursorFix],
  },
]

const contexts = await Promise.all(builds.map((b) => esbuild.context(b)))
if (watch) {
  await Promise.all(contexts.map((c) => c.watch()))
} else {
  for (const ctx of contexts) {
    const result = await ctx.rebuild()
    await ctx.dispose()
    for (const file of Object.keys(result.metafile.outputs)) {
      console.log(`${file.padEnd(28)} ${(statSync(file).size / 1024).toFixed(0).padStart(6)} KB`)
    }
  }
}
