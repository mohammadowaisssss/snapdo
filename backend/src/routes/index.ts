import { Router } from 'express';
import { authRouter } from './auth.routes.ts';
import { commentsRouter } from './comments.routes.ts';
import { filesRouter } from './files.routes.ts';
import { healthRouter } from './health.routes.ts';
import { membersRouter } from './members.routes.ts';
import { projectsRouter } from './projects.routes.ts';
import { tasksRouter } from './tasks.routes.ts';
import { teamsRouter } from './teams.routes.ts';
import { workspaceRouter } from './workspace.routes.ts';

export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use(tasksRouter);
apiRouter.use(commentsRouter);
apiRouter.use(projectsRouter);
apiRouter.use(teamsRouter);
apiRouter.use(membersRouter);
apiRouter.use(filesRouter);
apiRouter.use(workspaceRouter);
apiRouter.use(authRouter);
