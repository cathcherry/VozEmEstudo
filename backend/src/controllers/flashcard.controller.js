import { flashcardService } from '../services/flashcard.service.js';

export async function list(req, res, next) {
  try { res.json(await flashcardService.list(req.user.id, req.query)); }
  catch (error) { next(error); }
}

export async function create(req, res, next) {
  try { res.status(201).json(await flashcardService.create(req.user.id, req.body)); }
  catch (error) { next(error); }
}

export async function update(req, res, next) {
  try { res.json(await flashcardService.update(req.user.id, req.params.cardId, req.body)); }
  catch (error) { next(error); }
}

export async function history(req, res, next) {
  try { res.json(await flashcardService.history(req.user.id, req.params.cardId)); }
  catch (error) { next(error); }
}

export async function review(req, res, next) {
  try { res.json(await flashcardService.review(req.user.id, req.params.cardId, req.body)); }
  catch (error) { next(error); }
}
