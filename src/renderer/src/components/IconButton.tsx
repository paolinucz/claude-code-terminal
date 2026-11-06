import type { ButtonHTMLAttributes, ReactNode } from 'react'

/** Pulsante a icona con etichetta accessibile e suggerimento al passaggio del mouse. */
export function IconButton({
  label,
  children,
  className = '',
  ...rest
}: { label: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex size-6 items-center justify-center rounded-md text-text-subtle transition-colors hover:bg-border hover:text-foreground active:scale-95 ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
