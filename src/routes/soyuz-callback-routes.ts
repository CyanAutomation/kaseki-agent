import { Router, Request, Response } from 'express';
import { JobScheduler } from '../job-scheduler';
import { sendErrorResponse } from '../utils/response-helpers';

/** Operator inspection and manual retry for permanently rejected Soyuz callbacks. */
export function createSoyuzCallbackRoutes(scheduler: JobScheduler): Router {
  const router = Router();

  router.get('/soyuz/callbacks/blocked', async (_req: Request, res: Response) => {
    const callbacks = await scheduler.getBlockedSoyuzCallbacks();
    return res.json({ callbacks });
  });

  router.post('/soyuz/callbacks/:callbackId/retry', async (req: Request<{ callbackId: string }>, res: Response) => {
    const retried = await scheduler.retryBlockedSoyuzCallback(req.params.callbackId);
    if (!retried) {
      return sendErrorResponse(res, 409, 'Conflict', 'Only a blocked Soyuz callback can be retried');
    }
    return res.status(202).json({ callbackId: req.params.callbackId, status: 'pending' });
  });

  return router;
}
