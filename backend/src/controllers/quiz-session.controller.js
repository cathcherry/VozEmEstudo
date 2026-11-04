import { quizSessionService } from '../services/quiz-session.service.js';

export async function list(req, res, next) {
  try { res.json(await quizSessionService.list(req.user.id)); }
  catch (error) { next(error); }
}
export async function create(req, res, next) {
  try { res.status(201).json(await quizSessionService.create(req.user.id, req.body)); }
  catch (error) { next(error); }
}
export async function get(req, res, next) {
  try { res.json(await quizSessionService.get(req.user.id, req.params.sessionId)); }
  catch (error) { next(error); }
}
export async function diagnostic(req, res, next) {
  try { res.json(await quizSessionService.diagnostic(req.user.id, req.params.sessionId)); }
  catch (error) { next(error); }
}
export async function answer(req, res, next) {
  try { res.json(await quizSessionService.answer(req.user.id, req.params.sessionId, req.body)); }
  catch (error) { next(error); }
}
export async function finish(req, res, next) {
  try { res.json(await quizSessionService.finish(req.user.id, req.params.sessionId)); }
  catch (error) { next(error); }
}

export async function createReview(req, res, next) {
  try {
    res.status(201).json(await quizSessionService.createReview(
      req.user.id, req.params.sessionId, req.body,
    ));
  } catch (error) { next(error); }
}
