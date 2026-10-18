import {
  BLACKLIST_ERROR_COOLDOWN_MS,
  BLACKLIST_PREVIEW_COOLDOWN_MS,
  UPSTREAM_HEADERS,
  UPSTREAM_TIMEOUT_MS
} from '../config.js';
import { InstancePool } from './instancePool.js';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  isPreview?: boolean;
}

export type ResponseValidator = (data: any, response: Response) => ValidationResult;

export async function fetchFromPool(
  pool: InstancePool,
  pathAndQuery: string,
  options: RequestInit = {},
  validator?: ResponseValidator
): Promise<{ data: any; instance: string }> {
  const candidates = pool.getActiveInstances();

  if (!candidates || candidates.length === 0) {
    throw new Error('All upstream instances are currently blacklisted or unavailable');
  }

  let lastError: Error | null = null;

  for (const candidate of candidates) {
    const cleanBase = candidate.replace(/\/+$/, '');
    const url = `${cleanBase}${pathAndQuery.startsWith('/') ? '' : '/'}${pathAndQuery}`;

    try {
      const timeoutSignal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
      let signal: AbortSignal = timeoutSignal;

      if (options.signal) {
        // If caller passed a custom signal (e.g. client disconnect), abort on either
        signal = AbortSignal.any([timeoutSignal, options.signal]);
      }

      const headers = {
        ...UPSTREAM_HEADERS,
        ...(options.headers as Record<string, string> | undefined)
      };

      const response = await fetch(url, {
        ...options,
        headers,
        signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json = await response.json();

      // In-Loop Response Validation
      if (validator) {
        const validation = validator(json, response);
        if (!validation.valid) {
          const cooldown = validation.isPreview
            ? BLACKLIST_PREVIEW_COOLDOWN_MS
            : BLACKLIST_ERROR_COOLDOWN_MS;
          pool.markUnhealthy(cleanBase, cooldown);
          console.warn(
            `[Failover] Node ${cleanBase} rejected by validator (${validation.reason || 'unspecified'}). Failing over to next node...`
          );
          lastError = new Error(validation.reason || 'Validation failed');
          continue; // Automatically retries the NEXT candidate in the pool!
        }
      }

      return { data: json, instance: cleanBase };
    } catch (err: any) {
      pool.markUnhealthy(cleanBase, BLACKLIST_ERROR_COOLDOWN_MS);
      console.warn(`[Failover] Node ${cleanBase} failed: ${err.message}. Marking unhealthy for ${BLACKLIST_ERROR_COOLDOWN_MS}ms.`);
      lastError = err;
    }
  }

  throw new Error(
    `All upstream candidates failed. Last error: ${lastError ? lastError.message : 'Unknown error'}`
  );
}
