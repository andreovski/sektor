import { Button, Dialog } from '../../ui';

export function ConfirmDialog({
  title,
  text,
  action,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  action: string;
  onConfirm(): void;
  onClose(): void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={title}>
      <p className="mb-4 text-sm text-muted">{text}</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {action}
        </Button>
      </div>
    </Dialog>
  );
}
