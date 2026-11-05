import { Router } from 'express';
import {
  deleteTeamSql,
  insertTeamSql,
  listTeamsSql,
  patchTeamSql,
} from '../db/repository.ts';

export const teamsRouter = Router();

teamsRouter.get('/teams', (_req, res) => {
  res.json({ teams: listTeamsSql() });
});

teamsRouter.post('/teams', (req, res) => {
  try {
    const result = insertTeamSql(req.body || {});
    res.status(201).json({
      ok: true,
      team: result.team,
      updatedAt: result.updatedAt,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Unable to create team' });
  }
});

teamsRouter.patch('/teams/:id', (req, res) => {
  try {
    const result = patchTeamSql(req.params.id, req.body || {});
    if (!result) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    res.json({
      ok: true,
      team: result.team,
      updatedAt: result.updatedAt,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Unable to update team' });
  }
});

teamsRouter.delete('/teams/:id', (req, res) => {
  const result = deleteTeamSql(req.params.id);
  if (!result.ok) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }
  res.json({
    ok: true,
    updatedAt: result.updatedAt,
  });
});

