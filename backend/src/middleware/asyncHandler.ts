import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Express 4 does not catch rejections from async handlers: the promise is
 * dropped, becomes an unhandledRejection, and takes the process down with it.
 * Every route here is async and talks to the database, so a single failed query
 * was enough to kill the server.
 *
 * Wrapping a handler routes its rejection into Express's error handler, which
 * answers 500 and leaves the process serving.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
