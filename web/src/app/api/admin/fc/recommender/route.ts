import { NextResponse } from 'next/server';

import {
  applyRecommenderSelection,
  searchRecommenderCandidates,
} from '@/lib/admin-referrals';
import { logger } from '@/lib/logger';
import {
  handleRecommenderRelationGet,
  handleRecommenderRelationPost,
  type RecommenderRelationRouteDeps,
} from '@/lib/recommender-relation-route-handler';
import { getVerifiedServerSession } from '@/lib/server-session';

const deps: RecommenderRelationRouteDeps = {
  getSession: () => getVerifiedServerSession({
    allowedRoles: ['admin', 'manager'],
    requireActive: true,
  }),
  searchCandidates: searchRecommenderCandidates,
  applySelection: applyRecommenderSelection,
  logFailure: (error) => {
    logger.error('[api/admin/fc/recommender] failed', error);
  },
};

export async function GET(req: Request) {
  const result = await handleRecommenderRelationGet(req.url, deps);
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(req: Request) {
  const result = await handleRecommenderRelationPost(() => req.json(), deps);
  return NextResponse.json(result.body, { status: result.status });
}
