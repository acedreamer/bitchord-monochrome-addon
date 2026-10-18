import {
  DEFAULT_INSTANCES,
  DISCOVERY_REGISTRY_URL
} from '../config.js';

export class InstancePool {
  private instances: string[] = [];
  private blacklist: Map<string, number> = new Map(); // clean URL -> unblock timestamp

  constructor() {
    this.resetInstances();
  }

  /**
   * Resets instances to either HIFI_API_INSTANCES env override or DEFAULT_INSTANCES.
   */
  public resetInstances(): void {
    if (process.env.HIFI_API_INSTANCES) {
      const parsed = process.env.HIFI_API_INSTANCES.split(',')
        .map((s) => s.trim().replace(/\/+$/, ''))
        .filter((s) => s.length > 0 && this.isValidInstanceUrl(s));
      if (parsed.length > 0) {
        this.instances = parsed;
        return;
      }
    }

    this.instances = DEFAULT_INSTANCES.map((s) => s.replace(/\/+$/, ''));
  }

  /**
   * Checks if a URL is valid and not on dead/forbidden domains.
   */
  private isValidInstanceUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }
      const host = parsed.hostname.toLowerCase();
      // REQ-POL-04: Dead domains prohibited
      if (host.endsWith('monochrome.tf') || host.endsWith('spotisaver.net')) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Discovers new instances from the Monochrome GitHub registry and appends them.
   * REQ-POL-02: Appends behind verified fallback nodes to prevent unverified node latency.
   */
  public async initDynamicDiscovery(timeoutMs: number = 4000): Promise<string[]> {
    try {
      const signal = AbortSignal.timeout(timeoutMs);
      const res = await fetch(DISCOVERY_REGISTRY_URL, { signal });
      if (!res.ok) {
        return [];
      }
      const data: any = await res.json();
      const discovered: string[] = Array.isArray(data?.api) ? data.api : [];

      const currentSet = new Set(this.instances.map((u) => u.replace(/\/+$/, '')));
      const validToAdd: string[] = [];

      for (const rawUrl of discovered) {
        if (typeof rawUrl === 'string') {
          const clean = rawUrl.trim().replace(/\/+$/, '');
          if (this.isValidInstanceUrl(clean) && !currentSet.has(clean)) {
            currentSet.add(clean);
            validToAdd.push(clean);
          }
        }
      }

      if (validToAdd.length > 0) {
        this.instances = [...this.instances, ...validToAdd];
      }

      return validToAdd;
    } catch (err: any) {
      // Discovery failure is non-fatal: fallback nodes remain active
      return [];
    }
  }

  /**
   * Returns current active instances, filtering out currently blacklisted nodes.
   * Auto-cleans expired blacklist entries.
   */
  public getActiveInstances(): string[] {
    const now = Date.now();
    for (const [url, unblockTime] of this.blacklist.entries()) {
      if (now >= unblockTime) {
        this.blacklist.delete(url);
      }
    }

    return this.instances.filter((inst) => {
      const clean = inst.replace(/\/+$/, '');
      const unblockTime = this.blacklist.get(clean);
      return !unblockTime || now >= unblockTime;
    });
  }

  /**
   * Marks a specific instance URL as unhealthy for durationMs.
   */
  public markUnhealthy(url: string, durationMs: number): void {
    const clean = url.replace(/\/+$/, '');
    this.blacklist.set(clean, Date.now() + durationMs);
  }

  /**
   * Exposes raw instance list for testing or inspection.
   */
  public getAllInstances(): string[] {
    return [...this.instances];
  }

  /**
   * Manually sets instances (useful for testing).
   */
  public setInstances(instances: string[]): void {
    this.instances = instances
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter((s) => s.length > 0 && this.isValidInstanceUrl(s));
  }

  /**
   * Clears blacklist (useful for testing).
   */
  public clearBlacklist(): void {
    this.blacklist.clear();
  }

  /**
   * Checks if an instance is currently blacklisted.
   */
  public isBlacklisted(url: string): boolean {
    const clean = url.replace(/\/+$/, '');
    const expiry = this.blacklist.get(clean);
    if (!expiry) return false;
    if (Date.now() >= expiry) {
      this.blacklist.delete(clean);
      return false;
    }
    return true;
  }
}
