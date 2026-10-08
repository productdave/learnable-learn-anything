console.error([
  'The local Learnable course generator has been retired.',
  '',
  'Course creation now runs through the account-owned cloud generation_jobs pipeline:',
  '- web/api/gen/start.js creates the durable job',
  '- web/api/_lib/gen-runner.mjs runs the agent stages',
  '- web/api/gen/review.js resumes from human checkpoints',
  '- web/api/gen/sweep.js recovers timed-out jobs',
  '',
  'Open the app, sign in, and use New course so generation, checkpoints, recovery, and saved courses stay tied to the account.'
].join('\n'));

process.exit(1);
