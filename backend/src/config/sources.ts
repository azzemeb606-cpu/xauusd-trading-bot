import fs from 'node:fs';
import { env } from './env';
import {
  ContextPatterns,
  DEFAULT_CONTEXT_PATTERNS,
  DEFAULT_SIGNAL_PATTERNS,
  SignalPatterns,
} from '../scraper/parser';

/**
 * Scraping configuration per source page. Because the target website can
 * change its markup at any time, ALL extraction rules are data, not code:
 * override them with a JSON file (SOURCES_CONFIG) without rebuilding.
 * See config/sources.example.json.
 */
export interface SourceConfig<P> {
  url: string;
  /** CSS selector whose innerText is parsed. "body" also reads every iframe. */
  rootSelector: string;
  patterns: P;
}

export interface SourcesConfig {
  radar: SourceConfig<SignalPatterns>;
  main: SourceConfig<ContextPatterns>;
}

export function loadSourcesConfig(): SourcesConfig {
  const base: SourcesConfig = {
    radar: { url: env.RADAR_URL, rootSelector: 'body', patterns: { ...DEFAULT_SIGNAL_PATTERNS } },
    main: { url: env.MAIN_URL, rootSelector: 'body', patterns: { ...DEFAULT_CONTEXT_PATTERNS } },
  };
  if (!env.SOURCES_CONFIG) return base;
  const override = JSON.parse(fs.readFileSync(env.SOURCES_CONFIG, 'utf8')) as Partial<{
    radar: Partial<SourceConfig<Partial<SignalPatterns>>>;
    main: Partial<SourceConfig<Partial<ContextPatterns>>>;
  }>;
  return {
    radar: {
      url: override.radar?.url ?? base.radar.url,
      rootSelector: override.radar?.rootSelector ?? base.radar.rootSelector,
      patterns: { ...base.radar.patterns, ...(override.radar?.patterns ?? {}) },
    },
    main: {
      url: override.main?.url ?? base.main.url,
      rootSelector: override.main?.rootSelector ?? base.main.rootSelector,
      patterns: { ...base.main.patterns, ...(override.main?.patterns ?? {}) },
    },
  };
}
