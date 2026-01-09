/**
 * CSRF Protection Utilities
 *
 * Note: Next.js Server Actions have built-in CSRF protection via origin verification.
 * This module provides additional security layers for sensitive operations.
 */

import { headers } from 'next/headers';

/**
 * Verify the request comes from the same origin
 * Server Actions automatically check this, but we can add explicit verification
 */
export async function verifyOrigin(): Promise<{ valid: boolean; error?: string }> {
  const headersList = await headers();
  const origin = headersList.get('origin');
  const host = headersList.get('host');

  // For same-origin requests, origin might be null
  if (!origin) {
    // Check referer as fallback
    const referer = headersList.get('referer');
    if (!referer) {
      return { valid: true }; // Allow if no origin/referer (likely same-origin)
    }

    try {
      const refererUrl = new URL(referer);
      if (refererUrl.host !== host) {
        return {
          valid: false,
          error: 'Cross-origin request detected (referer mismatch)',
        };
      }
    } catch {
      return { valid: false, error: 'Invalid referer header' };
    }

    return { valid: true };
  }

  // Verify origin matches host
  try {
    const originUrl = new URL(origin);
    if (originUrl.host !== host) {
      return {
        valid: false,
        error: `Cross-origin request detected: ${origin} !== ${host}`,
      };
    }
  } catch {
    return { valid: false, error: 'Invalid origin header' };
  }

  return { valid: true };
}

/**
 * Rate limiting state (in-memory, resets on server restart)
 * For production, use Redis or similar persistent store
 */
const rateLimitStore = new Map<
  string,
  { count: number; resetAt: number }
>();

/**
 * Simple rate limiting for sensitive operations
 * @param key - Unique identifier (e.g., userId)
 * @param maxRequests - Maximum requests allowed in window
 * @param windowMs - Time window in milliseconds
 */
export function checkRateLimit(
  key: string,
  maxRequests = 10,
  windowMs = 60000 // 1 minute
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  // Clean up old entry
  if (entry && entry.resetAt < now) {
    rateLimitStore.delete(key);
  }

  const current = rateLimitStore.get(key);

  if (!current) {
    // First request in window
    const resetAt = now + windowMs;
    rateLimitStore.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: maxRequests - 1, resetAt };
  }

  if (current.count >= maxRequests) {
    // Rate limit exceeded
    return {
      allowed: false,
      remaining: 0,
      resetAt: current.resetAt,
    };
  }

  // Increment count
  current.count++;
  rateLimitStore.set(key, current);

  return {
    allowed: true,
    remaining: maxRequests - current.count,
    resetAt: current.resetAt,
  };
}

/**
 * Validate session for sensitive operations
 * Ensures user is authenticated before proceeding
 */
export function validateSession(session: unknown): {
  valid: boolean;
  error?: string;
} {
  if (!session || typeof session !== 'object') {
    return { valid: false, error: 'No session found' };
  }

  const sessionObj = session as Record<string, unknown>;

  if (!sessionObj.role) {
    return { valid: false, error: 'Invalid session: missing role' };
  }

  if (!sessionObj.residentId) {
    return { valid: false, error: 'Invalid session: missing user ID' };
  }

  return { valid: true };
}

/**
 * Security headers for sensitive responses
 */
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
} as const;

/**
 * Cleanup rate limit store periodically (call from cron or background job)
 */
export function cleanupRateLimitStore() {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
      cleaned++;
    }
  }

  return { cleaned, remaining: rateLimitStore.size };
}
