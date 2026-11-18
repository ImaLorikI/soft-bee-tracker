'use client';

import { format, parseISO } from 'date-fns';
import { CheckIcon, Undo2Icon, XIcon } from 'lucide-react';
import { useState } from 'react';

import { ErrorState } from '@components/common/error-state/error-state';
import { ReviewNoteDialog, type ReviewNoteTarget } from '@components/crew/review-note-dialog/review-note-dialog';
import { Badge } from '@ui/badge';
import { Button } from '@ui/button';
import { Skeleton } from '@ui/skeleton';
import type { CrewMember, CrewViewer } from '@/lib/api/crew';
import { useApproveTracker, useMemberTrackers, type Tracker, type TrackerStatus } from '@/lib/api/trackers';
import { canReviewTracker, getFullName, getTrackerReviewRange } from '@/lib/crew';
import { formatClock } from '@/lib/format-duration';
import { formatText } from '@/lib/format-text';
import { isLiveTrackerActive } from '@/lib/live-tracker';
import content from '../content.json';

// one member's time for managers and admins to approve, reject or undo.
// the trackers rls decides which entries come back (managers: their projects only)
export function MemberTimeReview({ member, viewer, projectNames, memberNames }: MemberTimeReviewProps) {
  const [range] = useState(() => getTrackerReviewRange(new Date()));
  const { data: trackers, isLoading, error, refetch } = useMemberTrackers({ userId: member.id, from: range.start, to: range.end });
  const approveTracker = useApproveTracker();
  const [noteTarget, setNoteTarget] = useState<ReviewNoteTarget | null>(null);
  const isMutating = approveTracker.isPending;
  const memberName = getFullName(member);
  const pendingCount = trackers?.filter((tracker) => tracker.status === 'new' && !isLiveTrackerActive(tracker)).length ?? 0;

  function getProjectName(tracker: Tracker): string {
    return projectNames.get(tracker.projectId) ?? content.timeReview.unknownProject;
  }

  function handleRetry() {
    void refetch();
  }

  function handleApprove(tracker: Tracker) {
    approveTracker.mutate(tracker.id);
  }

  function handleReject(tracker: Tracker) {
    setNoteTarget({ tracker, mode: 'reject' });
  }

  function handleUndo(tracker: Tracker) {
    setNoteTarget({ tracker, mode: 'undo' });
  }

  function handleNoteClose() {
    setNoteTarget(null);
  }

  return (
    <section aria-labelledby='member-time-review-title' className='bg-card flex flex-col gap-4 rounded-2xl border p-5 sm:p-8'>
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <div className='flex flex-col gap-1'>
          <h2 id='member-time-review-title' className='text-lg font-semibold'>
            {content.timeReview.title}
          </h2>
          <p className='text-muted-foreground text-sm'>
            {content.timeReview.period}
            {viewer.role === 'manager' ? ` · ${content.timeReview.onlyYourProjects}` : null}
          </p>
        </div>
        {pendingCount > 0 ? <Badge variant='info'>{formatText(content.timeReview.pendingCount, { count: pendingCount })}</Badge> : null}
      </div>

      {isLoading ? <TimeReviewSkeleton /> : null}

      {error ? <ErrorState error={error} title={content.timeReview.loadErrorTitle} onRetry={handleRetry} /> : null}

      {trackers && trackers.length === 0 ? <p className='text-muted-foreground text-sm'>{content.timeReview.empty}</p> : null}

      {trackers && trackers.length > 0 ? (
        <ul className='flex flex-col gap-2'>
          {trackers.map((tracker) => (
            <TimeReviewRow
              key={tracker.id}
              tracker={tracker}
              projectName={getProjectName(tracker)}
              reviewerName={tracker.reviewedBy ? (memberNames.get(tracker.reviewedBy) ?? content.timeReview.unknownReviewer) : null}
              canReview={canReviewTracker({ tracker, ownerRole: member.role, viewer })}
              isBusy={isMutating}
              onApprove={handleApprove}
              onReject={handleReject}
              onUndo={handleUndo}
            />
          ))}
        </ul>
      ) : null}

      <ReviewNoteDialog
        target={noteTarget}
        entryLabel={noteTarget ? formatEntryLabel(noteTarget.tracker, getProjectName(noteTarget.tracker)) : ''}
        memberName={memberName}
        onClose={handleNoteClose}
      />
    </section>
  );
}

function TimeReviewRow({ tracker, projectName, reviewerName, canReview, isBusy, onApprove, onReject, onUndo }: TimeReviewRowProps) {
  const isRunning = isLiveTrackerActive(tracker);
  const entryLabel = formatEntryLabel(tracker, projectName);
  const statusLabel = content.timeReview.status[tracker.status];

  function handleApproveClick() {
    onApprove(tracker);
  }

  function handleRejectClick() {
    onReject(tracker);
  }

  function handleUndoClick() {
    onUndo(tracker);
  }

  return (
    <li className='bg-muted/50 flex flex-col gap-2.5 rounded-xl px-3 py-2.5 sm:px-4'>
      <div className='flex flex-wrap items-center justify-between gap-x-4 gap-y-1'>
        <div className='flex min-w-0 flex-col'>
          <span className='text-sm font-medium break-words'>{projectName}</span>
          <span className='text-muted-foreground text-xs'>
            {format(parseISO(tracker.date), 'EEE, d MMM')} · {tracker.description?.trim() || content.timeReview.noDescription}
          </span>
        </div>
        <div className='flex shrink-0 items-center gap-3'>
          <span className='font-semibold tabular-nums'>{formatClock(tracker.durationMinutes)}</span>
          {isRunning ? (
            <Badge variant='warning'>{content.timeReview.running}</Badge>
          ) : (
            <Badge variant={STATUS_BADGE_VARIANTS[tracker.status]}>{statusLabel}</Badge>
          )}
        </div>
      </div>

      {reviewerName && tracker.reviewedAt ? (
        <p className='text-muted-foreground text-xs'>
          {formatText(content.timeReview.reviewedBy, {
            status: statusLabel,
            name: reviewerName,
            date: format(parseISO(tracker.reviewedAt), 'd MMM, HH:mm')
          })}
        </p>
      ) : null}

      {tracker.status === 'rejected' && tracker.reviewNote ? (
        <p className='text-sm break-words'>{formatText(content.timeReview.reason, { note: tracker.reviewNote })}</p>
      ) : null}

      {canReview ? (
        <div className='flex justify-end gap-2'>
          {tracker.status === 'new' ? (
            <>
              <Button
                variant='outline'
                size='sm'
                disabled={isBusy}
                aria-label={formatText(content.timeReview.rejectLabel, { entry: entryLabel })}
                onClick={handleRejectClick}
              >
                <XIcon data-icon='inline-start' />
                {content.timeReview.reject}
              </Button>
              <Button
                size='sm'
                disabled={isBusy}
                aria-label={formatText(content.timeReview.approveLabel, { entry: entryLabel })}
                onClick={handleApproveClick}
              >
                <CheckIcon data-icon='inline-start' />
                {content.timeReview.approve}
              </Button>
            </>
          ) : (
            <Button
              variant='ghost'
              size='sm'
              disabled={isBusy}
              aria-label={formatText(content.timeReview.undoLabel, { entry: entryLabel })}
              onClick={handleUndoClick}
            >
              <Undo2Icon data-icon='inline-start' />
              {content.timeReview.undo}
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}

function TimeReviewSkeleton() {
  return (
    <div className='flex flex-col gap-2'>
      <Skeleton className='h-16 w-full rounded-xl' />
      <Skeleton className='h-16 w-full rounded-xl' />
      <Skeleton className='h-16 w-full rounded-xl' />
    </div>
  );
}

function formatEntryLabel(tracker: Tracker, projectName: string): string {
  return `${projectName}, ${format(parseISO(tracker.date), 'd MMM')}, ${formatClock(tracker.durationMinutes)}`;
}

const STATUS_BADGE_VARIANTS: Record<TrackerStatus, 'info' | 'success' | 'destructive'> = {
  new: 'info',
  approved: 'success',
  rejected: 'destructive'
};

interface MemberTimeReviewProps {
  member: CrewMember;
  viewer: CrewViewer;
  projectNames: Map<string, string>;
  memberNames: Map<string, string>;
}

interface TimeReviewRowProps {
  tracker: Tracker;
  projectName: string;
  reviewerName: string | null;
  canReview: boolean;
  isBusy: boolean;
  onApprove: (tracker: Tracker) => void;
  onReject: (tracker: Tracker) => void;
  onUndo: (tracker: Tracker) => void;
}
