/**
 * Menu contestuale nativo di base per tutta l'app (Electron di suo non ne mostra nessuno): nei campi di testo
 * Annulla/Ripeti/Taglia/Copia/Incolla/Seleziona tutto, sul testo selezionato Copia. I pannelli che hanno un menu
 * proprio (editor, terminale, Markdown, Esplora file, spazi) bloccano l'evento e questo menu non compare.
 * Funzione pura, senza dipendenze da Electron, così si prova da sola.
 */
export interface ContextParams {
  isEditable: boolean
  selectionText: string
  editFlags: {
    canUndo: boolean
    canRedo: boolean
    canCut: boolean
    canCopy: boolean
    canPaste: boolean
    canSelectAll: boolean
  }
}

export type MenuItemTemplate =
  | { type: 'separator' }
  | { role: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'; label: string; enabled: boolean }

export function contextMenuTemplate(p: ContextParams): MenuItemTemplate[] {
  const f = p.editFlags
  if (p.isEditable) {
    return [
      { role: 'undo', label: 'Annulla', enabled: f.canUndo },
      { role: 'redo', label: 'Ripeti', enabled: f.canRedo },
      { type: 'separator' },
      { role: 'cut', label: 'Taglia', enabled: f.canCut },
      { role: 'copy', label: 'Copia', enabled: f.canCopy },
      { role: 'paste', label: 'Incolla', enabled: f.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: 'Seleziona tutto', enabled: f.canSelectAll }
    ]
  }
  if (p.selectionText.trim()) return [{ role: 'copy', label: 'Copia', enabled: f.canCopy }]
  return []
}
