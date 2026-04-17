import { randomUUID } from "node:crypto";
import { BciAttentionSignal, BciIngestionResponse } from "../types";

const round = (value: number): number => Number(value.toFixed(4));

/** Maximum number of signals retained in memory per user (ring-buffer eviction). */
const MAX_SIGNALS_PER_USER = 500;

/** Weights used to derive a single composite attention score. */
const ATTENTION_WEIGHT = 0.4;
const ENGAGEMENT_WEIGHT = 0.35;
const FOCUS_WEIGHT = 0.25;

function computeCompositeScore(signal: BciAttentionSignal): number {
  return round(
    signal.attentionScore * ATTENTION_WEIGHT +
      signal.engagementScore * ENGAGEMENT_WEIGHT +
      signal.focusScore * FOCUS_WEIGHT
  );
}

export interface AggregatedBciMetrics {
  userId: string;
  sampleCount: number;
  averageAttention: number;
  averageEngagement: number;
  averageFocus: number;
  averageCompositeScore: number;
  totalAdExposureMs: number;
}

export class BciAttentionStore {
  private readonly signals = new Map<string, BciIngestionResponse[]>();

  ingest(input: BciAttentionSignal): BciIngestionResponse {
    const signalId = randomUUID();
    const occurredAt = input.occurredAt ?? new Date().toISOString();

    const record: BciIngestionResponse = {
      signalId,
      userId: input.userId,
      sessionId: input.sessionId,
      platform: input.platform,
      campaignId: input.campaignId,
      attentionScore: round(input.attentionScore),
      engagementScore: round(input.engagementScore),
      focusScore: round(input.focusScore),
      adExposureMs: input.adExposureMs,
      occurredAt,
      compositeScore: computeCompositeScore(input)
    };

    const existing = this.signals.get(input.userId) ?? [];
    existing.push(record);
    // Evict the oldest signal when the per-user cap is reached
    if (existing.length > MAX_SIGNALS_PER_USER) {
      existing.shift();
    }
    this.signals.set(input.userId, existing);

    return record;
  }

  getLatest(userId: string, limit = 10): BciIngestionResponse[] {
    const all = this.signals.get(userId) ?? [];
    return all.slice(-limit);
  }

  getAggregated(userId: string): AggregatedBciMetrics | null {
    const all = this.signals.get(userId);

    if (!all || all.length === 0) {
      return null;
    }

    const count = all.length;
    const totals = all.reduce(
      (acc, s) => ({
        attention: acc.attention + s.attentionScore,
        engagement: acc.engagement + s.engagementScore,
        focus: acc.focus + s.focusScore,
        composite: acc.composite + s.compositeScore,
        adMs: acc.adMs + (s.adExposureMs ?? 0)
      }),
      { attention: 0, engagement: 0, focus: 0, composite: 0, adMs: 0 }
    );

    return {
      userId,
      sampleCount: count,
      averageAttention: round(totals.attention / count),
      averageEngagement: round(totals.engagement / count),
      averageFocus: round(totals.focus / count),
      averageCompositeScore: round(totals.composite / count),
      totalAdExposureMs: totals.adMs
    };
  }
}

export const bciAttentionStore = new BciAttentionStore();
