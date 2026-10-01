import { AppError } from '@go-short/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { AppContext } from '../context';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Route not found' },
    requestId: req.requestId,
  });
};

export const errorHandler =
  (_ctx: AppContext): ErrorRequestHandler =>
  (err, req, res, _next) => {
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: unknown;

    if (err instanceof AppError) {
      status = err.status;
      code = err.code;
      message = err.message;
      details = err.details;
    } else if (err instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'Invalid request';
      details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    } else if (err instanceof SyntaxError && 'body' in err) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'Malformed JSON body';
    } else if (typeof err?.status === 'number' && err.status === 413) {
      status = 413;
      code = 'VALIDATION_ERROR';
      message = 'Request body too large';
    }

    if (status >= 500) req.log.error({ err }, 'unhandled error');
    // Stack traces and internal messages never leave the process.
    res.status(status).json({
      success: false,
      error: { code, message, ...(details ? { details } : {}) },
      requestId: req.requestId,
    });
  };
