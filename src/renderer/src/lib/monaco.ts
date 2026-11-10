/**
 * Monaco caricato dal pacchetto locale (non da una CDN) con il suo worker, e il tema dell'app.
 * Si importa solo dove serve (diff, editor) con React.lazy: Monaco pesa qualche MB.
 */
import * as monaco from 'monaco-editor'
// In Monaco 0.57 il pacchetto esporta «monaco-editor/<percorso>» → esm/vs/<percorso>.js
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import { loader } from '@monaco-editor/react'

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker()
}

loader.config({ monaco })

monaco.editor.defineTheme('cct-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '71717a', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'e8875f' },
    { token: 'string', foreground: '6fd39b' },
    { token: 'number', foreground: 'f5c46b' },
    { token: 'type', foreground: '6ea8fe' }
  ],
  colors: {
    'editor.background': '#09090b',
    'editor.foreground': '#e4e4e7',
    'editorLineNumber.foreground': '#52525b',
    'editorLineNumber.activeForeground': '#a1a1aa',
    'editor.lineHighlightBackground': '#18181b',
    'editorGutter.background': '#09090b',
    'diffEditor.insertedTextBackground': '#6fd39b26',
    'diffEditor.removedTextBackground': '#ff8a8a26',
    'diffEditor.insertedLineBackground': '#17332280',
    'diffEditor.removedLineBackground': '#3a1d2280',
    'diffEditor.diagonalFill': '#27272a',
    'editorOverviewRuler.border': '#27272a',
    'scrollbarSlider.background': '#3f3f4680',
    'scrollbarSlider.hoverBackground': '#52525b',
    'editorWidget.background': '#18181b',
    'editorWidget.border': '#3f3f46',
    // Menu contestuale (tasto destro) e menu a tendina: senza questi colori restava trasparente.
    'menu.background': '#18181b',
    'menu.foreground': '#e4e4e7',
    'menu.selectionBackground': '#3f3f46',
    'menu.selectionForeground': '#fafafa',
    'menu.separatorBackground': '#3f3f46',
    'menu.border': '#3f3f46',
    'widget.shadow': '#00000080'
  }
})

/** Linguaggio di Monaco in base all'estensione del file. */
export function languageOf(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop() ?? ''
  const map: Record<string, string> = {
    java: 'java', kt: 'kotlin', ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
    cjs: 'javascript', py: 'python', xml: 'xml', pom: 'xml', yml: 'yaml', yaml: 'yaml', sql: 'sql', json: 'json',
    md: 'markdown', html: 'html', css: 'css', scss: 'scss', sh: 'shell', ps1: 'powershell', bat: 'bat', cmd: 'bat',
    properties: 'ini', ini: 'ini', toml: 'ini', gradle: 'groovy', go: 'go', rs: 'rust', cs: 'csharp', c: 'c', h: 'c',
    cpp: 'cpp', hpp: 'cpp', rb: 'ruby', php: 'php', dockerfile: 'dockerfile'
  }
  return map[ext] ?? 'plaintext'
}

export { monaco }
