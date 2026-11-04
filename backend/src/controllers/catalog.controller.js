import { catalogService } from '../services/catalog.service.js';

export async function list(req, res, next) {
  try {
    res.json(await catalogService.list(req.user.id));
  } catch (error) {
    next(error);
  }
}

export async function createSubject(req, res, next) {
  try {
    res.status(201).json(await catalogService.createSubject(req.user.id, req.body));
  } catch (error) {
    next(error);
  }
}

export async function createUnit(req, res, next) {
  try {
    res
      .status(201)
      .json(await catalogService.createUnit(req.user.id, req.params.subjectId, req.body));
  } catch (error) {
    next(error);
  }
}

export async function assignMaterial(req, res, next) {
  try {
    res.json(await catalogService.assignMaterial(req.user.id, req.params.materialId, req.body));
  } catch (error) {
    next(error);
  }
}
