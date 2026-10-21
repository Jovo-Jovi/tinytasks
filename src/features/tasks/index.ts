export const featureName = 'tasks' as const;

export const TASK_STATUSES = ['todo', 'in-progress', 'done'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'Todo',
  'in-progress': 'In Progress',
  done: 'Done',
};
