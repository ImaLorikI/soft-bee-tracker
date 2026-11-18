'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { XIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';

import { Button } from '@ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@ui/dialog';
import { Field, FieldError, FieldLabel } from '@ui/field';
import { Textarea } from '@ui/textarea';
import { useRejectTracker, type Tracker } from '@/lib/api/trackers';
import { formatText } from '@/lib/format-text';
import {
  REJECT_TRACKER_FORM_DEFAULTS,
  rejectTrackerFormSchema,
  type RejectTrackerFormValues
} from '@/lib/schemas/reject-tracker-form.schema';
import content from '../content.json';

// open while `tracker` is set; the parent clears it to close
export function RejectTrackerDialog({ tracker, entryLabel, memberName, onClose }: RejectTrackerDialogProps) {
  const {
    formState: { errors },
    handleSubmit,
    register,
    reset
  } = useForm<RejectTrackerFormValues>({
    defaultValues: REJECT_TRACKER_FORM_DEFAULTS,
    resolver: zodResolver(rejectTrackerFormSchema)
  });
  const rejectTracker = useRejectTracker({ onSuccess: handleRejected });
  const isBusy = rejectTracker.isPending;

  function handleRejected() {
    reset(REJECT_TRACKER_FORM_DEFAULTS);
    onClose();
  }

  function handleRejectSubmit(values: RejectTrackerFormValues) {
    if (tracker) {
      rejectTracker.mutate({ trackerId: tracker.id, note: values.note });
    }
  }

  function handleFormSubmit(event: React.FormEvent<HTMLFormElement>) {
    void handleSubmit(handleRejectSubmit)(event);
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    if (nextOpen || isBusy) {
      return;
    }

    reset(REJECT_TRACKER_FORM_DEFAULTS);
    onClose();
  }

  function handleCancelClick() {
    handleDialogOpenChange(false);
  }

  return (
    <Dialog open={tracker !== null} onOpenChange={handleDialogOpenChange} disablePointerDismissal={isBusy}>
      <DialogContent className='sm:max-w-md' showCloseButton={!isBusy}>
        <DialogHeader>
          <DialogTitle>{content.rejectTrackerDialog.title}</DialogTitle>
          <DialogDescription>
            {formatText(content.rejectTrackerDialog.description, { entry: entryLabel, name: memberName })}
          </DialogDescription>
        </DialogHeader>

        <form className='grid gap-6' onSubmit={handleFormSubmit} noValidate>
          <Field data-invalid={Boolean(errors.note)}>
            <FieldLabel htmlFor='rejectTrackerNote'>{content.rejectTrackerDialog.reasonLabel}</FieldLabel>
            <Textarea
              id='rejectTrackerNote'
              rows={3}
              maxLength={500}
              autoFocus
              placeholder={content.rejectTrackerDialog.reasonPlaceholder}
              disabled={isBusy}
              aria-invalid={Boolean(errors.note)}
              {...register('note')}
            />
            <FieldError errors={[errors.note]} />
          </Field>

          <DialogFooter>
            <Button type='button' variant='outline' disabled={isBusy} onClick={handleCancelClick}>
              {content.rejectTrackerDialog.cancelButton}
            </Button>
            <Button type='submit' variant='destructive' disabled={isBusy}>
              <XIcon data-icon='inline-start' />
              {isBusy ? content.rejectTrackerDialog.submittingButton : content.rejectTrackerDialog.submitButton}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface RejectTrackerDialogProps {
  tracker: Tracker | null;
  entryLabel: string;
  memberName: string;
  onClose: () => void;
}
