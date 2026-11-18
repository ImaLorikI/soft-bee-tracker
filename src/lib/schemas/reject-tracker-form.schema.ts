import { z } from 'zod';

import content from './content.json';

// matches trackers_review_note_length_check and the blank-reason check in guard_tracker_review
export const rejectTrackerFormSchema = z.object({
  note: z.string().trim().min(1, content.trackerReview.reasonRequired).max(500, content.trackerReview.reasonTooLong)
});

export const REJECT_TRACKER_FORM_DEFAULTS: RejectTrackerFormValues = { note: '' };

export interface RejectTrackerFormValues {
  note: string;
}
