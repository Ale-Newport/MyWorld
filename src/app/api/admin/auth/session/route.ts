import { adminApi, json } from '@/server/auth/guard'

export const runtime = 'nodejs'

export const GET = adminApi(async (_req, { session }) => json({
  user: { id: session.user.id, email: session.user.email, name: session.user.name },
  csrf: session.csrf,
  expiresAt: session.expiresAt,
}))
