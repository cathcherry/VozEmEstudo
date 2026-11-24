import { randomUUID } from 'node:crypto';

// A client-supplied id is kept only when it is short and plain (it is echoed and logged).
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export function requestIdMiddleware(req, res, next) {
  const supplied = req.get('x-request-id');
  req.requestId = supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}
