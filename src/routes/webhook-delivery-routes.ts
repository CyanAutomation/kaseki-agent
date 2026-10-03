import { Router, Request, Response } from 'express';
import { JobScheduler } from '../job-scheduler';
import { sendErrorResponse } from '../utils/response-helpers';

/** Run-scoped inspection and manual retry for durable webhook delivery history. */
export function createWebhookDeliveryRoutes(scheduler: JobScheduler): Router {
  const router = Router();

  router.get('/runs/:id/webhook-deliveries', async (req: Request, res: Response) => {
    const job = typeof scheduler.getJobIncludingHistory === 'function'
      ? await scheduler.getJobIncludingHistory(req.params.id)
      : scheduler.getJob(req.params.id);
    if (!job) return sendErrorResponse(res, 404, 'Not Found', `Run not found: ${req.params.id}`);
    return res.json({ deliveries: scheduler.getWebhookDeliveries(req.params.id) });
  });

  router.post('/runs/:id/webhook-deliveries/:deliveryId/retry', async (req: Request, res: Response) => {
    const job = typeof scheduler.getJobIncludingHistory === 'function'
      ? await scheduler.getJobIncludingHistory(req.params.id)
      : scheduler.getJob(req.params.id);
    if (!job) return sendErrorResponse(res, 404, 'Not Found', `Run not found: ${req.params.id}`);

    const delivery = scheduler.getWebhookDeliveries(req.params.id)
      .find((candidate) => candidate.id === req.params.deliveryId);
    if (!delivery) return sendErrorResponse(res, 404, 'Not Found', 'Webhook delivery not found');
    if (delivery.status !== 'failed') {
      return sendErrorResponse(res, 409, 'Conflict', 'Only a failed webhook delivery can be retried');
    }
    if (!scheduler.retryWebhookDelivery(req.params.id, delivery.id)) {
      return sendErrorResponse(res, 409, 'Conflict', 'Webhook delivery changed before it could be retried');
    }

    return res.status(202).json({ id: delivery.id, jobId: req.params.id, status: 'pending' });
  });

  return router;
}
