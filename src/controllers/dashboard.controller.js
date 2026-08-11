import * as dashboardService from '../services/dashboard.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/httpResponse.js';

export const getAdminDashboard = asyncHandler(async (req, res) => {
  const days = Number.parseInt(req.query.days, 10);
  const data = await dashboardService.getAdminDashboard({
    days: Number.isNaN(days) || days < 1 || days > 365 ? 14 : days,
  });
  return ok(res, data);
});

export const getMyDashboard = asyncHandler(async (req, res) => {
  const data = await dashboardService.getAgentDashboard(req.user);
  return ok(res, data);
});
