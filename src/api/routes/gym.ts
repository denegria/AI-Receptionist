import { Request, Response, Router } from 'express';
import Database from 'better-sqlite3';
import { getClientDatabase } from '../../db/client';

export const gymRouter = Router();

type GymIntakeStatus = 'new' | 'in_review' | 'needs_changes' | 'ready_for_recommendation' | 'recommended' | 'approved';
type GymRecommendationStatus = 'draft' | 'needs_review' | 'changes_requested' | 'revised' | 'approved' | 'rejected';
type GymRecommendationSectionId = 'calories' | 'macros' | 'meal_plan' | 'workout_plan' | 'rationale' | 'confidence';

type GymIntake = {
  id: string;
  memberName: string;
  memberEmail?: string;
  status: GymIntakeStatus;
  submittedAt: string;
  age?: number;
  weight?: string;
  height?: string;
  experienceLevel?: 'beginner' | 'intermediate' | 'advanced';
  primaryGoals: string[];
  injuriesOrLimitations: string[];
  mobilityConcerns: string[];
  availableTrainingDays: string[];
  dietaryRestrictions: string[];
  dietaryPreferences: string[];
  foodDislikes: string[];
  lifestyleConstraints: string[];
  desiredFocusAreas: string[];
  notes?: string;
};

type GymRecommendationSection = { id: GymRecommendationSectionId; title: string; content: string; editable?: boolean };
type GymRecommendationVersion = { version: number; updatedAt: string; changedBy: string; changeSummary: string; sections: GymRecommendationSection[]; missingInfoFlags: string[] };
type GymRecommendation = {
  id: string;
  intakeId: string;
  status: GymRecommendationStatus;
  version: number;
  updatedAt: string;
  sections: GymRecommendationSection[];
  missingInfoFlags: string[];
  versions: GymRecommendationVersion[];
  lastAction?: { action: 'needs_review' | 'approved' | 'rejected' | 'changes_requested' | 'revised'; by: string; at: string; note?: string };
};
type GymApproval = { id: string; recommendationId: string; reviewerName: string; status: GymRecommendationStatus; updatedAt: string; notes?: string };
type GymTimelineEvent = {
  id: string;
  entityType: 'intake' | 'recommendation' | 'approval' | 'task';
  entityId: string;
  type: 'intake_submitted' | 'intake_status_changed' | 'recommendation_drafted' | 'recommendation_revised' | 'recommendation_submitted_for_review' | 'recommendation_approved' | 'recommendation_changes_requested' | 'recommendation_rejected' | 'task_created' | 'task_completed';
  title: string;
  description?: string;
  createdAt: string;
  actor: string;
  metadata?: Record<string, string | number | boolean | null>;
};
type GymTask = {
  id: string;
  intakeId: string;
  recommendationId?: string;
  title: string;
  details: string;
  status: 'open' | 'blocked' | 'done';
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
  updatedAt: string;
  dueAt?: string;
  source: 'missing_info' | 'review_state' | 'manual';
  sourceLabel: string;
};
type GymState = { intakes: GymIntake[]; recommendations: GymRecommendation[]; approvals: GymApproval[]; timeline: GymTimelineEvent[]; tasks: GymTask[] };

const transitions: Record<GymRecommendationStatus, GymRecommendationStatus[]> = {
  draft: ['needs_review', 'changes_requested'],
  needs_review: ['approved', 'changes_requested', 'rejected', 'revised'],
  changes_requested: ['revised', 'rejected'],
  revised: ['needs_review', 'approved', 'changes_requested'],
  approved: [],
  rejected: [],
};

function canTransition(from: GymRecommendationStatus, to: GymRecommendationStatus) {
  return transitions[from].includes(to);
}

function requireTenantId(req: Request, res: Response): string | null {
  const tenantId = (typeof req.query.tenantId === 'string' ? req.query.tenantId : typeof req.body?.tenantId === 'string' ? req.body.tenantId : '').trim();
  if (!tenantId) {
    res.status(400).json({ error: 'Missing tenantId' });
    return null;
  }
  return tenantId;
}

function requireCapability(req: Request, res: Response, needed: 'gym:read' | 'gym:write'): boolean {
  const raw = String(req.headers['x-tenant-capabilities'] || '');
  const caps = raw.split(',').map((c) => c.trim()).filter(Boolean);
  if (!caps.includes(needed) && !caps.includes('gym:*')) {
    res.status(403).json({ error: `Missing capability: ${needed}` });
    return false;
  }
  return true;
}

function ensureGymTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gym_workflow_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state_json TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }
function isoNow() { return new Date().toISOString(); }
function makeId(prefix: string) { return `${prefix}-${Math.random().toString(36).slice(2, 10)}`; }

function seedState(): GymState {
  const now = Date.now();
  const at = isoNow();
  return {
    intakes: [
      { id: 'intake-001', memberName: 'Jordan Reyes', memberEmail: 'jordan@example.com', status: 'in_review', submittedAt: new Date(now - 1000 * 60 * 35).toISOString(), age: 32, weight: '182 lb', height: '5 ft 10 in', experienceLevel: 'intermediate', primaryGoals: ['fat loss', 'strength'], injuriesOrLimitations: ['left shoulder irritation'], mobilityConcerns: ['tight hips'], availableTrainingDays: ['Mon', 'Wed', 'Fri'], dietaryRestrictions: ['none'], dietaryPreferences: ['high protein'], foodDislikes: ['mushrooms'], lifestyleConstraints: ['travels for work 2x per month'], desiredFocusAreas: ['upper body strength', 'consistency'], notes: 'Prefers evening workouts.' },
      { id: 'intake-002', memberName: 'Tanya Moore', status: 'ready_for_recommendation', submittedAt: new Date(now - 1000 * 60 * 90).toISOString(), age: 45, weight: '161 lb', height: '5 ft 6 in', experienceLevel: 'beginner', primaryGoals: ['energy', 'fat loss'], injuriesOrLimitations: ['knee sensitivity'], mobilityConcerns: ['ankle stiffness'], availableTrainingDays: ['Tue', 'Thu', 'Sat'], dietaryRestrictions: ['dairy-free'], dietaryPreferences: ['simple meals'], foodDislikes: ['spicy food'], lifestyleConstraints: ['desk job'], desiredFocusAreas: ['core', 'conditioning'] },
    ],
    recommendations: [
      { id: 'rec-001', intakeId: 'intake-001', status: 'needs_review', version: 2, updatedAt: new Date(now - 1000 * 60 * 18).toISOString(), missingInfoFlags: ['confirmed calorie target', 'sleep schedule'], sections: [
        { id: 'calories', title: 'Calorie Intake Recommendation', content: 'Start at 2,350 kcal/day and adjust weekly based on scale trend and recovery.', editable: true },
        { id: 'macros', title: 'Macros Recommendation', content: 'Protein 190g, carbs 230g, fat 75g. Prioritize protein at each meal.', editable: true },
        { id: 'meal_plan', title: 'Meal Plan / Dietary Guidance', content: 'Three main meals and one post-training snack. Keep lunches simple and portable.', editable: true },
        { id: 'workout_plan', title: 'Workout Plan', content: '3-day full-body split with shoulder-friendly pressing, supported rows, and low-impact conditioning.', editable: true },
        { id: 'rationale', title: 'Rationale / Notes', content: 'Intermediate trainee with fat loss + strength goal, shoulder limitation, and weekday schedule.', editable: false },
        { id: 'confidence', title: 'Confidence / Missing Info', content: 'Confidence is moderate. We still need sleep and exact calorie history to tighten targets.', editable: false },
      ], versions: [] },
      { id: 'rec-002', intakeId: 'intake-002', status: 'draft', version: 1, updatedAt: new Date(now - 1000 * 60 * 48).toISOString(), missingInfoFlags: ['activity level'], sections: [
        { id: 'calories', title: 'Calorie Intake Recommendation', content: 'Start near 1,900 kcal/day with a conservative deficit and monitor energy.', editable: true },
        { id: 'macros', title: 'Macros Recommendation', content: 'Protein 155g, carbs 180g, fat 60g.', editable: true },
        { id: 'meal_plan', title: 'Meal Plan / Dietary Guidance', content: 'Dairy-free meal structure with repeatable breakfasts and high-satiety lunches.', editable: true },
        { id: 'workout_plan', title: 'Workout Plan', content: '2-day strength + low-impact conditioning plan focused on adherence and joint comfort.', editable: true },
        { id: 'rationale', title: 'Rationale / Notes', content: 'Beginner with joint sensitivity needs a simple, confidence-building ramp.', editable: false },
        { id: 'confidence', title: 'Confidence / Missing Info', content: 'We need activity level to sharpen the calorie target and weekly volume.', editable: false },
      ], versions: [] },
    ],
    approvals: [
      { id: 'approval-001', recommendationId: 'rec-001', reviewerName: 'Alvaro', status: 'needs_review', updatedAt: new Date(now - 1000 * 60 * 8).toISOString(), notes: 'Review shoulder-safe movements and confirm calorie target.' },
      { id: 'approval-002', recommendationId: 'rec-002', reviewerName: 'Alvaro', status: 'draft', updatedAt: new Date(now - 1000 * 60 * 24).toISOString() },
    ],
    timeline: [
      { id: 'timeline-intake-001', entityType: 'intake', entityId: 'intake-001', type: 'intake_submitted', title: 'Intake submitted', description: 'Jordan Reyes submitted a structured intake for review.', createdAt: at, actor: 'system' },
      { id: 'timeline-rec-001', entityType: 'recommendation', entityId: 'rec-001', type: 'recommendation_submitted_for_review', title: 'Recommendation moved to review', description: 'Coach pass completed with missing-info follow-up still open.', createdAt: at, actor: 'Alvaro' },
      { id: 'timeline-rec-002', entityType: 'recommendation', entityId: 'rec-002', type: 'recommendation_drafted', title: 'Draft created', description: 'Draft exists but still needs review before approval.', createdAt: at, actor: 'system' },
    ],
    tasks: [
      { id: 'task-001', intakeId: 'intake-001', recommendationId: 'rec-001', title: 'Confirm sleep schedule', details: 'Collect sleep timing and consistency to tighten recovery and calorie guidance.', status: 'open', priority: 'high', createdAt: at, updatedAt: at, source: 'missing_info', sourceLabel: 'missing info flag: sleep schedule' },
      { id: 'task-002', intakeId: 'intake-002', recommendationId: 'rec-002', title: 'Collect activity level', details: 'Need daily movement context to sharpen calorie target and weekly volume.', status: 'open', priority: 'medium', createdAt: at, updatedAt: at, source: 'missing_info', sourceLabel: 'missing info flag: activity level' },
    ],
  };
}

function loadState(db: Database.Database): GymState {
  ensureGymTables(db);
  const row = db.prepare('SELECT state_json as stateJson FROM gym_workflow_state WHERE id = 1').get() as { stateJson: string } | undefined;
  if (!row?.stateJson) {
    const initial = seedState();
    db.prepare('INSERT OR REPLACE INTO gym_workflow_state (id, state_json, updated_at) VALUES (1, ?, ?)').run(JSON.stringify(initial), isoNow());
    return initial;
  }
  try {
    return JSON.parse(row.stateJson) as GymState;
  } catch {
    const initial = seedState();
    db.prepare('INSERT OR REPLACE INTO gym_workflow_state (id, state_json, updated_at) VALUES (1, ?, ?)').run(JSON.stringify(initial), isoNow());
    return initial;
  }
}

function saveState(db: Database.Database, state: GymState) {
  db.prepare('INSERT OR REPLACE INTO gym_workflow_state (id, state_json, updated_at) VALUES (1, ?, ?)').run(JSON.stringify(state), isoNow());
}

function syncApproval(state: GymState, recommendationId: string, status: GymRecommendationStatus, updatedAt: string, notes?: string) {
  const approval = state.approvals.find((item) => item.recommendationId === recommendationId);
  if (approval) {
    approval.status = status;
    approval.updatedAt = updatedAt;
    approval.notes = notes || approval.notes;
    return;
  }
  state.approvals.unshift({ id: `approval-${recommendationId}`, recommendationId, reviewerName: 'Alvaro', status, updatedAt, notes });
}

function upsertTimelineEvent(state: GymState, event: Omit<GymTimelineEvent, 'id' | 'createdAt'> & { createdAt?: string }) {
  state.timeline.unshift({ id: makeId('timeline'), createdAt: event.createdAt || isoNow(), ...event });
}

function upsertTask(state: GymState, task: Omit<GymTask, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
  const existing = state.tasks.find((item) => item.intakeId === task.intakeId && item.sourceLabel === task.sourceLabel && item.status !== 'done');
  const record = { id: task.id || existing?.id || makeId('task'), createdAt: existing?.createdAt || isoNow(), updatedAt: isoNow(), ...task } as GymTask;
  if (existing) Object.assign(existing, record); else state.tasks.unshift(record);
  return record;
}

function reconcileRecommendationTasks(state: GymState, recommendation: GymRecommendation, actor = 'system') {
  const linkedTaskLabels = new Set<string>();
  recommendation.missingInfoFlags.forEach((flag, index) => {
    const task = upsertTask(state, {
      intakeId: recommendation.intakeId,
      recommendationId: recommendation.id,
      title: `Resolve ${flag}`,
      details: `Follow up on ${flag} before closing the gym workflow.`,
      status: recommendation.status === 'approved' ? 'done' : 'open',
      priority: index === 0 ? 'high' : 'medium',
      source: 'missing_info',
      sourceLabel: `missing info flag: ${flag}`,
    });
    linkedTaskLabels.add(task.sourceLabel);
    if (recommendation.status !== 'approved') {
      upsertTimelineEvent(state, { entityType: 'task', entityId: task.id, type: 'task_created', title: task.title, description: task.details, actor, metadata: { intakeId: recommendation.intakeId, recommendationId: recommendation.id } });
    }
  });
  state.tasks
    .filter((task) => task.recommendationId === recommendation.id && task.source === 'missing_info' && !linkedTaskLabels.has(task.sourceLabel) && task.status !== 'done')
    .forEach((task) => {
      task.status = 'done';
      task.updatedAt = isoNow();
      upsertTimelineEvent(state, { entityType: 'task', entityId: task.id, type: 'task_completed', title: task.title, description: 'Missing info was resolved.', actor, metadata: { recommendationId: recommendation.id } });
    });
}

gymRouter.get('/queues', (req: Request, res: Response) => {
  if (!requireCapability(req, res, 'gym:read')) return;
  const tenantId = requireTenantId(req, res);
  if (!tenantId) return;
  const db = getClientDatabase(tenantId);
  const state = loadState(db);
  return res.json({ intakeQueue: state.intakes, recommendations: state.recommendations, approvalQueue: state.approvals, timeline: state.timeline, tasks: state.tasks });
});

gymRouter.get('/intakes/:intakeId', (req: Request, res: Response) => {
  if (!requireCapability(req, res, 'gym:read')) return;
  const tenantId = requireTenantId(req, res);
  if (!tenantId) return;
  const db = getClientDatabase(tenantId);
  const state = loadState(db);
  const intake = state.intakes.find((item) => item.id === req.params.intakeId) || null;
  return res.json(intake);
});

gymRouter.get('/recommendations/:idOrIntakeId', (req: Request, res: Response) => {
  if (!requireCapability(req, res, 'gym:read')) return;
  const tenantId = requireTenantId(req, res);
  if (!tenantId) return;
  const db = getClientDatabase(tenantId);
  const state = loadState(db);
  const recommendation = state.recommendations.find((item) => item.id === req.params.idOrIntakeId || item.intakeId === req.params.idOrIntakeId) || null;
  return res.json(recommendation);
});

gymRouter.get('/approvals/:recommendationId', (req: Request, res: Response) => {
  if (!requireCapability(req, res, 'gym:read')) return;
  const tenantId = requireTenantId(req, res);
  if (!tenantId) return;
  const db = getClientDatabase(tenantId);
  const state = loadState(db);
  const approval = state.approvals.find((item) => item.recommendationId === req.params.recommendationId) || null;
  return res.json(approval);
});

gymRouter.get('/timeline', (req: Request, res: Response) => {
  if (!requireCapability(req, res, 'gym:read')) return;
  const tenantId = requireTenantId(req, res);
  if (!tenantId) return;
  const entityId = typeof req.query.entityId === 'string' ? req.query.entityId : '';
  const db = getClientDatabase(tenantId);
  const state = loadState(db);
  return res.json(state.timeline.filter((event) => !entityId || event.entityId === entityId));
});

gymRouter.get('/tasks', (req: Request, res: Response) => {
  if (!requireCapability(req, res, 'gym:read')) return;
  const tenantId = requireTenantId(req, res);
  if (!tenantId) return;
  const intakeId = typeof req.query.intakeId === 'string' ? req.query.intakeId : '';
  const db = getClientDatabase(tenantId);
  const state = loadState(db);
  return res.json(state.tasks.filter((task) => !intakeId || task.intakeId === intakeId));
});

gymRouter.post('/recommendations/:recommendationId/sections', (req: Request, res: Response) => {
  if (!requireCapability(req, res, 'gym:write')) return;
  const tenantId = requireTenantId(req, res);
  if (!tenantId) return;
  const sectionId = String(req.body?.sectionId || '');
  const content = String(req.body?.content || '');
  const editorName = String(req.body?.editorName || 'Alvaro');
  const db = getClientDatabase(tenantId);
  const state = loadState(db);

  const recommendation = state.recommendations.find((item) => item.id === req.params.recommendationId);
  if (!recommendation) return res.status(404).json({ error: 'Recommendation not found' });
  const section = recommendation.sections.find((item) => item.id === sectionId);
  if (!section || section.editable === false) return res.status(400).json({ error: 'Section is not editable' });
  if (recommendation.status === 'approved' || recommendation.status === 'rejected') {
    return res.status(400).json({ error: `Cannot edit recommendation in ${recommendation.status} state` });
  }

  section.content = content;
  recommendation.version += 1;
  recommendation.updatedAt = isoNow();
  recommendation.status = 'needs_review';
  recommendation.lastAction = { action: 'revised', by: editorName, at: recommendation.updatedAt, note: `Edited ${sectionId}` };
  recommendation.versions.unshift({ version: recommendation.version, updatedAt: recommendation.updatedAt, changedBy: editorName, changeSummary: `Edited ${sectionId}`, sections: clone(recommendation.sections), missingInfoFlags: clone(recommendation.missingInfoFlags) });
  upsertTimelineEvent(state, { entityType: 'recommendation', entityId: recommendation.id, type: 'recommendation_revised', title: `Section ${sectionId} edited`, description: `Recommendation v${recommendation.version} was updated by ${editorName}.`, actor: editorName, metadata: { intakeId: recommendation.intakeId } });
  reconcileRecommendationTasks(state, recommendation, editorName);
  syncApproval(state, recommendation.id, 'needs_review', recommendation.updatedAt, `Section ${sectionId} edited`);
  saveState(db, state);

  return res.json(recommendation);
});

gymRouter.post('/recommendations/:recommendationId/transitions', (req: Request, res: Response) => {
  if (!requireCapability(req, res, 'gym:write')) return;
  const tenantId = requireTenantId(req, res);
  if (!tenantId) return;
  const nextStatus = String(req.body?.nextStatus || '') as GymRecommendationStatus;
  const reviewerName = String(req.body?.reviewerName || 'Alvaro');
  const note = typeof req.body?.note === 'string' ? req.body.note : undefined;

  const db = getClientDatabase(tenantId);
  const state = loadState(db);
  const recommendation = state.recommendations.find((item) => item.id === req.params.recommendationId);
  if (!recommendation) return res.status(404).json({ error: 'Recommendation not found' });
  if (!canTransition(recommendation.status, nextStatus)) {
    return res.status(400).json({ error: `Invalid gym recommendation transition: ${recommendation.status} -> ${nextStatus}` });
  }

  recommendation.status = nextStatus;
  recommendation.updatedAt = isoNow();
  if (nextStatus !== 'draft') recommendation.lastAction = { action: nextStatus === 'changes_requested' ? 'changes_requested' : nextStatus, by: reviewerName, at: recommendation.updatedAt, note };
  if (nextStatus === 'approved' || nextStatus === 'rejected' || nextStatus === 'changes_requested') {
    recommendation.versions.unshift({ version: recommendation.version, updatedAt: recommendation.updatedAt, changedBy: reviewerName, changeSummary: nextStatus === 'approved' ? 'Approved' : nextStatus === 'rejected' ? 'Rejected' : 'Changes requested', sections: clone(recommendation.sections), missingInfoFlags: clone(recommendation.missingInfoFlags) });
  }

  reconcileRecommendationTasks(state, recommendation, reviewerName);
  upsertTimelineEvent(state, { entityType: 'recommendation', entityId: recommendation.id, type: nextStatus === 'approved' ? 'recommendation_approved' : nextStatus === 'rejected' ? 'recommendation_rejected' : nextStatus === 'changes_requested' ? 'recommendation_changes_requested' : 'recommendation_submitted_for_review', title: nextStatus === 'approved' ? 'Recommendation approved' : nextStatus === 'rejected' ? 'Recommendation rejected' : nextStatus === 'changes_requested' ? 'Changes requested' : 'Moved to review', description: note, actor: reviewerName, metadata: { intakeId: recommendation.intakeId } });

  if (nextStatus === 'approved') {
    state.tasks.filter((task) => task.recommendationId === recommendation.id && task.status !== 'done').forEach((task) => {
      task.status = 'done';
      task.updatedAt = isoNow();
    });
    recommendation.missingInfoFlags.forEach((flag) => {
      upsertTask(state, { intakeId: recommendation.intakeId, recommendationId: recommendation.id, title: `Resolved ${flag}`, details: `Resolved during approval for ${recommendation.id}.`, status: 'done', priority: 'low', source: 'review_state', sourceLabel: `approval resolution: ${flag}` });
    });
  }

  syncApproval(state, recommendation.id, nextStatus, recommendation.updatedAt, note);
  saveState(db, state);
  return res.json(recommendation);
});
