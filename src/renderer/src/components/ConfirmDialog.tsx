import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui-kit'

/** Conferma per le azioni che tolgono qualcosa (requisiti §8: Alert Dialog). */
export function ConfirmDialog(props: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  onConfirm(): void
  onCancel(): void
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={(open) => !open && props.onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annulla</AlertDialogCancel>
          <AlertDialogAction
            onClick={props.onConfirm}
            className={props.destructive ? 'bg-danger text-on-brand hover:bg-danger/90' : undefined}
          >
            {props.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
