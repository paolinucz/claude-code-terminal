/**
 * Componenti dell'interfaccia (requisiti §8), costruiti sulle primitive animate di Animate UI
 * (`@animate-ui/react/primitives/radix-ui`) con lo stile del tema dell'app.
 * Il resto dell'app importa solo da qui, così lo stile resta in un posto solo.
 */
import type { ComponentProps } from 'react'
import { ChevronRight } from 'lucide-react'
import {
  AlertDialog as AD,
  ContextMenu as CM,
  Dialog as D,
  DropdownMenu as DM
} from '@animate-ui/react/primitives/radix-ui'
import { cn } from '@/lib/cn'

/* ---------------- Dialog ---------------- */

const overlayClass = 'fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]'
const modalClass =
  'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-0 rounded-xl border border-strong bg-surface p-5 text-[13px] text-foreground shadow-2xl outline-none sm:max-w-lg'

export const Dialog = D.Dialog
export const DialogTrigger = D.DialogTrigger
export const DialogClose = D.DialogClose

export function DialogContent({ className, children, ...props }: ComponentProps<typeof D.DialogContent>) {
  return (
    <D.DialogPortal>
      <D.DialogOverlay className={overlayClass} />
      <D.DialogContent className={cn(modalClass, className)} {...props}>
        {children}
      </D.DialogContent>
    </D.DialogPortal>
  )
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5', className)} {...props} />
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof D.DialogTitle>) {
  return <D.DialogTitle className={cn('text-[15px] font-semibold leading-tight', className)} {...props} />
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof D.DialogDescription>) {
  return <D.DialogDescription className={cn('leading-relaxed text-text-subtle', className)} {...props} />
}

/* ---------------- Alert Dialog ---------------- */

export const AlertDialog = AD.AlertDialog

export function AlertDialogContent({ className, children, ...props }: ComponentProps<typeof AD.AlertDialogContent>) {
  return (
    <AD.AlertDialogPortal>
      <AD.AlertDialogOverlay className={overlayClass} />
      <AD.AlertDialogContent className={cn(modalClass, 'gap-5 sm:max-w-md', className)} {...props}>
        {children}
      </AD.AlertDialogContent>
    </AD.AlertDialogPortal>
  )
}

export const AlertDialogHeader = DialogHeader
export const AlertDialogFooter = DialogFooter

export function AlertDialogTitle({ className, ...props }: ComponentProps<typeof AD.AlertDialogTitle>) {
  return <AD.AlertDialogTitle className={cn('text-[15px] font-semibold leading-tight', className)} {...props} />
}

export function AlertDialogDescription({ className, ...props }: ComponentProps<typeof AD.AlertDialogDescription>) {
  return <AD.AlertDialogDescription className={cn('leading-relaxed text-text-subtle', className)} {...props} />
}

export function AlertDialogAction({ className, ...props }: ComponentProps<typeof AD.AlertDialogAction>) {
  return (
    <AD.AlertDialogAction
      className={cn('h-9 rounded-lg bg-brand px-4 font-semibold text-on-brand transition-opacity hover:opacity-90', className)}
      {...props}
    />
  )
}

export function AlertDialogCancel({ className, ...props }: ComponentProps<typeof AD.AlertDialogCancel>) {
  return (
    <AD.AlertDialogCancel
      className={cn(
        'h-9 rounded-lg border border-border px-4 text-text-muted transition-colors hover:bg-border hover:text-foreground',
        className
      )}
      {...props}
    />
  )
}

/* ---------------- Menu (Dropdown e Context) ---------------- */

const menuContentClass =
  'z-50 min-w-44 overflow-hidden rounded-lg border border-strong bg-surface p-1 text-[13px] text-foreground shadow-xl outline-none'
const menuItemClass =
  'relative flex min-h-8 cursor-default select-none items-center gap-2 rounded-md px-2 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-border data-[state=open]:bg-border'
const menuLabelClass = 'px-2 pt-1.5 pb-1 text-[11px] font-medium text-text-faint'
const menuSeparatorClass = '-mx-1 my-1 h-px bg-border'

export const DropdownMenu = DM.DropdownMenu
export const DropdownMenuTrigger = DM.DropdownMenuTrigger
export const DropdownMenuSub = DM.DropdownMenuSub

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof DM.DropdownMenuContent>) {
  return (
    <DM.DropdownMenuPortal>
      <DM.DropdownMenuContent sideOffset={sideOffset} className={cn(menuContentClass, className)} {...props} />
    </DM.DropdownMenuPortal>
  )
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof DM.DropdownMenuItem>) {
  return <DM.DropdownMenuItem className={cn(menuItemClass, className)} {...props} />
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof DM.DropdownMenuLabel>) {
  return <DM.DropdownMenuLabel className={cn(menuLabelClass, className)} {...props} />
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof DM.DropdownMenuSeparator>) {
  return <DM.DropdownMenuSeparator className={cn(menuSeparatorClass, className)} {...props} />
}

export function DropdownMenuSubTrigger({ className, children, ...props }: ComponentProps<typeof DM.DropdownMenuSubTrigger>) {
  return (
    <DM.DropdownMenuSubTrigger className={cn(menuItemClass, className)} {...props}>
      {children}
      <ChevronRight size={14} className="ml-auto text-text-faint" />
    </DM.DropdownMenuSubTrigger>
  )
}

export function DropdownMenuSubContent({ className, ...props }: ComponentProps<typeof DM.DropdownMenuSubContent>) {
  return (
    <DM.DropdownMenuPortal>
      <DM.DropdownMenuSubContent className={cn(menuContentClass, className)} {...props} />
    </DM.DropdownMenuPortal>
  )
}

export const ContextMenu = CM.ContextMenu
export const ContextMenuTrigger = CM.ContextMenuTrigger

export function ContextMenuContent({ className, ...props }: ComponentProps<typeof CM.ContextMenuContent>) {
  return (
    <CM.ContextMenuPortal>
      <CM.ContextMenuContent className={cn(menuContentClass, className)} {...props} />
    </CM.ContextMenuPortal>
  )
}

export function ContextMenuItem({ className, ...props }: ComponentProps<typeof CM.ContextMenuItem>) {
  return <CM.ContextMenuItem className={cn(menuItemClass, className)} {...props} />
}

export function ContextMenuSeparator({ className, ...props }: ComponentProps<typeof CM.ContextMenuSeparator>) {
  return <CM.ContextMenuSeparator className={cn(menuSeparatorClass, className)} {...props} />
}
