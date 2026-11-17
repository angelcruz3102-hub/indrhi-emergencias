import { Router } from 'express';
import { authenticate } from '../auth.js';
import { pingDb } from '../db.js';
import { devicesRouter } from './devices.js';
import { alertsRouter } from './alerts.js';
import { incidentsRouter } from './incidents.js';
import { buildingsRouter } from './buildings.js';
import { contactsRouter } from './contacts.js';
import { floorPlansRouter } from './floorPlans.js';
import { shiftsRouter } from './shifts.js';
import { dutyOverridesRouter } from './dutyOverrides.js';
import { adminRouter } from './admin.js';
import { drillsRouter } from './drills.js';

export const apiRouter = Router();

apiRouter.get('/health', async (_req, res) => {
  const ok = await pingDb();
  res.status(ok ? 200 : 503).json({ db: ok });
});

apiRouter.use(authenticate);
apiRouter.use('/devices', devicesRouter);
apiRouter.use('/alerts', alertsRouter);
apiRouter.use('/incidents', incidentsRouter);
apiRouter.use('/buildings', buildingsRouter);
apiRouter.use('/contacts', contactsRouter);
apiRouter.use('/floor-plans', floorPlansRouter);
apiRouter.use('/shifts', shiftsRouter);
apiRouter.use('/duty-overrides', dutyOverridesRouter);
apiRouter.use('/drills', drillsRouter);
apiRouter.use('/', adminRouter);
