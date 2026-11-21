import { Router } from 'express';
import { classroomService as service } from '../services/classroom.service.js';
import { limitPerAccount } from '../middleware/rate-limit.middleware.js';

// Private to class members: never cached, never indexed, no referrer.
const action =
  (fn, status = 200) =>
  async (req, res, next) => {
    try {
      res.set({
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Robots-Tag': 'noindex, nofollow',
      });
      res.status(status).json(await fn(req));
    } catch (error) {
      next(error);
    }
  };

export const classroomRouter = Router();
const r = classroomRouter;
const p = (q) => q.params;
// Joining guesses codes; limit attempts per account (in addition to expiry and max uses).
r.post(
  '/join',
  limitPerAccount({ name: 'classroom-join', max: 30, windowMs: 3600000 }),
  action((q) => service.join(q.user, q.body)),
);
r.get(
  '/',
  action((q) => service.list(q.user)),
);
r.post(
  '/',
  action((q) => service.create(q.user, q.body), 201),
);
r.get(
  '/:classId',
  action((q) => service.get(q.user, p(q).classId)),
);
r.patch(
  '/:classId',
  action((q) => service.update(q.user, p(q).classId, q.body)),
);
r.get(
  '/:classId/members',
  action((q) => service.members(q.user, p(q).classId)),
);
r.post(
  '/:classId/leave',
  action((q) => service.leave(q.user, p(q).classId)),
);
r.patch(
  '/:classId/members/:userId',
  action((q) => service.setRole(q.user, p(q).classId, p(q).userId, q.body)),
);
r.delete(
  '/:classId/members/:userId',
  action((q) => service.removeMember(q.user, p(q).classId, p(q).userId)),
);
r.get(
  '/:classId/invites',
  action((q) => service.invites(q.user, p(q).classId)),
);
r.post(
  '/:classId/invites',
  action((q) => service.createInvite(q.user, p(q).classId, q.body), 201),
);
r.delete(
  '/:classId/invites/:inviteId',
  action((q) => service.revokeInvite(q.user, p(q).classId, p(q).inviteId)),
);
r.get(
  '/:classId/lessons',
  action((q) => service.lessons(q.user, p(q).classId)),
);
r.post(
  '/:classId/lessons',
  action((q) => service.publish(q.user, p(q).classId, q.body), 201),
);
r.get(
  '/:classId/lessons/:lessonId',
  action((q) => service.lesson(q.user, p(q).classId, p(q).lessonId)),
);
r.delete(
  '/:classId/lessons/:lessonId',
  action((q) => service.unpublish(q.user, p(q).classId, p(q).lessonId)),
);
r.get(
  '/:classId/submissions',
  action((q) => service.submissions(q.user, p(q).classId)),
);
r.post(
  '/:classId/submissions',
  action((q) => service.submit(q.user, p(q).classId, q.body), 201),
);
r.get(
  '/:classId/submissions/:submissionId',
  action((q) => service.submission(q.user, p(q).classId, p(q).submissionId)),
);
r.post(
  '/:classId/submissions/:submissionId/transitions',
  action((q) => service.transition(q.user, p(q).classId, p(q).submissionId, q.body)),
);
r.get(
  '/:classId/flashcard-sets',
  action((q) => service.sharedSets(q.user, p(q).classId)),
);
r.post(
  '/:classId/flashcard-sets',
  action((q) => service.shareSet(q.user, p(q).classId, q.body), 201),
);
r.get(
  '/:classId/flashcard-sets/:sharedId',
  action((q) => service.sharedSet(q.user, p(q).classId, p(q).sharedId)),
);
r.delete(
  '/:classId/flashcard-sets/:sharedId',
  action((q) => service.revokeShared(q.user, p(q).classId, p(q).sharedId)),
);
r.get(
  '/:classId/resources',
  action((q) => service.resources(q.user, p(q).classId)),
);
r.post(
  '/:classId/resources',
  action((q) => service.addResource(q.user, p(q).classId, q.body), 201),
);
r.delete(
  '/:classId/resources/:resourceId',
  action((q) => service.removeResource(q.user, p(q).classId, p(q).resourceId)),
);
