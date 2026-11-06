import type { DockviewTheme } from 'dockview-react'

/** Tema Dockview dell'app. Le variabili CSS stanno in styles.css, sotto `.dockview-theme-cct`. */
export const cctDockTheme: DockviewTheme = {
  name: 'cct',
  className: 'dockview-theme-cct',
  colorScheme: 'dark',
  gap: 6,
  dndOverlayMounting: 'relative',
  dndPanelOverlay: 'group',
  dndTabIndicator: 'line',
  tabGroupIndicator: 'none',
  tabAnimation: 'smooth'
}
