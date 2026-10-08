import { HUMAN_REVIEW_STATUSES } from './gen-state.mjs';
import { isPendingContinuation, ownsContinuationRun } from './gen-continuation.mjs';

export const RECOVERABLE_STATUSES = ['failed', 'timed_out', 'partial'];
export const REVIEW_STATUSES = HUMAN_REVIEW_STATUSES;
export const MAX_AUTO_RECOVERY_ATTEMPTS = 2;
export const AUTO_RECOVERY_EXHAUSTED_ERROR = 'Automatic cloud recovery reached its retry limit.';

export function isRecoverableStatus(status) {
  return RECOVERABLE_STATUSES.includes(status);
}

export function isReviewStatus(status) {
  return REVIEW_STATUSES.includes(status);
}

export function isImageOnlyRecovery(job) {
  return (job?.stage === 'images' || job?.stage === 'assemble' && job.image_progress?.status === 'complete') && !!job.saved_course_id
    && job.user_brief?.materials_policy === 'integrated-visuals-v2'
    && (job.user_brief?.visual_designer_policy !== 'learner-experience-v1' || job.design_progress?.status === 'complete')
    && !hasPendingRestartIntent(job);
}

export function resumeModeFor(job) {
  if (!job?.brief || job.stage === 'intake') return 'curriculum';
  if (job.stage === 'research') return 'research';
  return 'complete';
}

export function recoveryModeFor(job) {
  return hasPendingRestartIntent(job) ? 'curriculum' : resumeModeFor(job);
}

export function resumeStageFor(job) {
  if (!job?.brief || job.stage === 'intake') return 'intake';
  if (job.stage === 'research') return 'research';
  if (job.stage === 'design' || job.user_brief?.visual_designer_policy === 'learner-experience-v1'
    && job.saved_course_id && ['images','assemble'].includes(job.stage) && job.design_progress?.status !== 'complete') return 'design';
  if (isImageOnlyRecovery(job)) return job.stage;
  if (job.stage === 'images') return 'images';
  return 'topics';
}

export function recoveryStageFor(job) {
  return hasPendingRestartIntent(job) ? 'intake' : resumeStageFor(job);
}

export function checkpointForJob(job) {
  return {
    stage: job.stage || null,
    brief: job.brief || null,
    research: job.research || {},
    topics_by_key: job.topics_by_key || {},
    failures: job.failures || [],
    extracted_urls: job.extracted_urls || [],
    saved_course_id: job.saved_course_id || null,
    image_progress: job.image_progress || null,
    design_progress: job.design_progress || null
  };
}

export function recoveryCheckpointForJob(job) {
  if (!hasPendingRestartIntent(job)) return checkpointForJob(job);
  return {
    extracted_urls: job.extracted_urls || []
  };
}

export function hasPendingRestartIntent(job) {
  return /restart(?:ing)? from (?:the |your )?saved request/i.test(`${job?.error || ''}\n${job?.message || ''}`);
}

export function recoveryAttemptsFor(job) {
  return Math.max(0, Number(job?.recovery_attempts || 0) || 0);
}

export function canAutoRecover(job) {
  if (job?.continuation != null && !isPendingContinuation(job)) return false;
  return job?.status === 'timed_out' && recoveryAttemptsFor(job) < MAX_AUTO_RECOVERY_ATTEMPTS;
}

export function autoRecoveryFailurePatch(job, err, now = new Date().toISOString()) {
  if (job?.continuation != null) return {
    status: 'failed', error: err?.message || 'Automatic continuation could not be confirmed.',
    message: 'Automatic continuation stopped. Your saved work is retained. Review the issue before resuming.',
    heartbeat_at: now, updated_at: now, completed_at: now
  };
  const attempted = recoveryAttemptsFor(job) + 1;
  const willRetry = attempted < MAX_AUTO_RECOVERY_ATTEMPTS;
  return {
    status: 'timed_out',
    recovery_attempts: attempted,
    error: err?.message || String(err || 'Unknown automatic recovery failure.'),
    message: willRetry ? autoRecoveryRetryMessage(job) : autoRecoveryPausedMessage(job),
    heartbeat_at: now,
    updated_at: now,
    completed_at: now
  };
}

export function autoRecoveryRetryMessage(job) {
  return hasPendingRestartIntent(job)
    ? 'Automatic recovery attempt failed. Learnable will retry from the saved request.'
    : 'Automatic recovery attempt failed. Learnable will retry from the saved checkpoint.';
}

export function autoRecoveryPausedMessage(job) {
  return hasPendingRestartIntent(job)
    ? 'Automatic recovery paused after repeated recovery attempts. You can manually restart from the saved request.'
    : 'Automatic recovery paused after repeated recovery attempts. You can manually resume from the saved checkpoint.';
}

export function autoRecoveryExhaustedPatch(job, now = new Date().toISOString()) {
  return {
    message: autoRecoveryPausedMessage(job),
    error: AUTO_RECOVERY_EXHAUSTED_ERROR,
    updated_at: now
  };
}

export function timeoutPatch(jobOrNow = new Date().toISOString(), maybeNow = null) {
  const job = jobOrNow && typeof jobOrNow === 'object' ? jobOrNow : null;
  const now = typeof jobOrNow === 'string'
    ? jobOrNow
    : (maybeNow || new Date().toISOString());
  const pendingRestart = hasPendingRestartIntent(job);
  if (job?.continuation != null && (!ownsContinuationRun(job) || job.continuation.phase !== 'pending')) return {
    status: 'failed', error: 'An automatic continuation ended without a confirmed checkpoint. Its result or charge may be uncertain.',
    message: 'Automatic continuation stopped. Your saved work is retained. Review the issue before resuming.',
    updated_at: now, completed_at: now
  };
  return {
    status: 'timed_out',
    message: pendingRestart
      ? 'Generation timed out while restarting. You can restart from the saved request.'
      : 'Generation timed out. You can resume from the latest checkpoint.',
    error: pendingRestart
      ? 'Cloud restart timed out before the next checkpoint.'
      : 'Cloud generation timed out before the next checkpoint.',
    updated_at: now,
    completed_at: now
  };
}
