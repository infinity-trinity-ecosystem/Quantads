import { randomUUID } from "node:crypto";
import { BidAggregationRequest, BidAggregator, RankedYieldBid } from "./BidAggregator";

export interface ArbitrageDecision {
  evaluationId: string;
  advertiserId: string;
  auctionId: string;
  slotId: string;
  generatedAt: string;
  baselineOutcomeBid: number;
  decision: "execute" | "hold";
  selectedBid: RankedYieldBid | null;
  fallbackFloorCpm: number;
  summary: {
    eligibleBidCount: number;
    timedOutBidCount: number;
    averageLatencyMs: number;
    bestYieldScore: number;
    bestArbitrageSpread: number;
    marketHeat: number;
  };
  rationale: string[];
  alternatives: RankedYieldBid[];
}

interface StoredDecision extends ArbitrageDecision {
  platform: BidAggregationRequest["slot"]["platform"];
}

const MAX_HISTORY = 250;

const round = (value: number, digits = 4): number => Number(value.toFixed(digits));

export class ArbitrageEngine {
  private readonly aggregator = new BidAggregator();
  private readonly history: StoredDecision[] = [];

  evaluate(request: BidAggregationRequest): ArbitrageDecision {
    const aggregation = this.aggregator.aggregate(request);
    const eligible = aggregation.rankedBids.filter((bid) => !bid.timedOut);
    const selectedBid = eligible.find((bid) => bid.arbitrageSpread > 0 && bid.expectedYieldScore > 0) ?? null;
    const averageLatencyMs =
      aggregation.rankedBids.length > 0
        ? aggregation.rankedBids.reduce((total, bid) => total + bid.responseLatencyMs, 0) / aggregation.rankedBids.length
        : 0;
    const marketHeat =
      eligible.length > 0
        ? eligible.reduce((total, bid) => total + bid.bidCpm, 0) / eligible.length / Math.max(request.slot.floorCpm, 0.01)
        : 0;
    const fallbackFloorCpm = round(
      Math.max(
        request.slot.floorCpm,
        request.slot.floorCpm * (0.95 + request.pulse.attentionDepth * 0.2 + request.audience.intentScore * 0.15)
      ),
      4
    );
    const evaluation: ArbitrageDecision = {
      evaluationId: randomUUID(),
      advertiserId: request.advertiserId,
      auctionId: request.auctionId,
      slotId: request.slotId,
      generatedAt: new Date().toISOString(),
      baselineOutcomeBid: aggregation.baselineOutcomeBid,
      decision: selectedBid ? "execute" : "hold",
      selectedBid,
      fallbackFloorCpm,
      summary: {
        eligibleBidCount: eligible.length,
        timedOutBidCount: aggregation.rankedBids.filter((bid) => bid.timedOut).length,
        averageLatencyMs: round(averageLatencyMs, 3),
        bestYieldScore: aggregation.rankedBids[0]?.expectedYieldScore ?? 0,
        bestArbitrageSpread: aggregation.rankedBids[0]?.arbitrageSpread ?? 0,
        marketHeat: round(marketHeat, 4)
      },
      rationale: this.buildRationale(request, aggregation.baselineOutcomeBid, aggregation.rankedBids, selectedBid),
      alternatives: aggregation.rankedBids.slice(0, 3)
    };

    this.history.unshift({
      ...evaluation,
      platform: request.slot.platform
    });
    if (this.history.length > MAX_HISTORY) {
      this.history.length = MAX_HISTORY;
    }

    return evaluation;
  }

  getDashboard() {
    const totalAuctions = this.history.length;
    const executedAuctions = this.history.filter((entry) => entry.decision === "execute").length;
    const timeoutEvents = this.history.reduce((total, entry) => total + entry.summary.timedOutBidCount, 0);
    const bidEvents = this.history.reduce(
      (total, entry) => total + entry.summary.timedOutBidCount + entry.summary.eligibleBidCount,
      0
    );
    const averageYieldSpread =
      executedAuctions > 0
        ? this.history
            .filter((entry) => entry.selectedBid)
            .reduce((total, entry) => total + (entry.selectedBid?.arbitrageSpread ?? 0), 0) / executedAuctions
        : 0;

    const bidderMap = new Map<
      string,
      { bidderId: string; wins: number; averageYieldSpread: number; averageLatencyMs: number; samples: number }
    >();
    const formatMap = new Map<string, { creativeStyle: string; wins: number; averageYieldScore: number; samples: number }>();

    for (const entry of this.history) {
      if (!entry.selectedBid) {
        continue;
      }

      const bidder = bidderMap.get(entry.selectedBid.bidderId) ?? {
        bidderId: entry.selectedBid.bidderId,
        wins: 0,
        averageYieldSpread: 0,
        averageLatencyMs: 0,
        samples: 0
      };
      bidder.wins += 1;
      bidder.samples += 1;
      bidder.averageYieldSpread += entry.selectedBid.arbitrageSpread;
      bidder.averageLatencyMs += entry.selectedBid.responseLatencyMs;
      bidderMap.set(entry.selectedBid.bidderId, bidder);

      const format = formatMap.get(entry.selectedBid.creativeStyle) ?? {
        creativeStyle: entry.selectedBid.creativeStyle,
        wins: 0,
        averageYieldScore: 0,
        samples: 0
      };
      format.wins += 1;
      format.samples += 1;
      format.averageYieldScore += entry.selectedBid.expectedYieldScore;
      formatMap.set(entry.selectedBid.creativeStyle, format);
    }

    return {
      summary: {
        totalAuctions,
        executedAuctions,
        holdRate: totalAuctions > 0 ? round((totalAuctions - executedAuctions) / totalAuctions, 4) : 0,
        averageYieldSpread: round(averageYieldSpread, 4),
        timeoutRate: bidEvents > 0 ? round(timeoutEvents / bidEvents, 4) : 0,
        averageMarketHeat:
          totalAuctions > 0 ? round(this.history.reduce((total, entry) => total + entry.summary.marketHeat, 0) / totalAuctions, 4) : 0
      },
      bidderLeaderboard: [...bidderMap.values()]
        .map((row) => ({
          bidderId: row.bidderId,
          wins: row.wins,
          averageYieldSpread: round(row.averageYieldSpread / Math.max(row.samples, 1), 4),
          averageLatencyMs: round(row.averageLatencyMs / Math.max(row.samples, 1), 4)
        }))
        .sort((left, right) => right.wins - left.wins || right.averageYieldSpread - left.averageYieldSpread)
        .slice(0, 6),
      formatMix: [...formatMap.values()]
        .map((row) => ({
          creativeStyle: row.creativeStyle,
          wins: row.wins,
          averageYieldScore: round(row.averageYieldScore / Math.max(row.samples, 1), 4)
        }))
        .sort((left, right) => right.wins - left.wins || right.averageYieldScore - left.averageYieldScore),
      recentAuctions: this.history.slice(0, 8).map((entry) => ({
        evaluationId: entry.evaluationId,
        auctionId: entry.auctionId,
        slotId: entry.slotId,
        platform: entry.platform,
        decision: entry.decision,
        bidderId: entry.selectedBid?.bidderId ?? null,
        creativeStyle: entry.selectedBid?.creativeStyle ?? null,
        yieldSpread: entry.selectedBid?.arbitrageSpread ?? 0,
        generatedAt: entry.generatedAt
      }))
    };
  }

  private buildRationale(
    request: BidAggregationRequest,
    baselineOutcomeBid: number,
    rankedBids: RankedYieldBid[],
    selectedBid: RankedYieldBid | null
  ): string[] {
    const topCandidate = rankedBids[0];
    const rationale = [
      `Audience baseline value is $${baselineOutcomeBid.toFixed(2)} per verified outcome for slot ${request.slotId}.`,
      `Pulse attention depth ${(request.pulse.attentionDepth * 100).toFixed(0)}% and viewability ${(request.slot.viewabilityEstimate * 100).toFixed(0)}% were used to arbitrage bids by yield instead of raw CPM.`,
      `${rankedBids.filter((bid) => bid.timedOut).length} of ${rankedBids.length} bids exceeded the ${request.timeoutBudgetMs ?? 10}ms timeout budget.`
    ];

    if (selectedBid) {
      rationale.push(
        `Selected ${selectedBid.bidderId} (${selectedBid.creativeStyle}) with expected yield score ${selectedBid.expectedYieldScore.toFixed(2)} and arbitrage spread $${selectedBid.arbitrageSpread.toFixed(2)}.`
      );
    } else if (topCandidate) {
      rationale.push(
        `Held the slot because the best eligible spread was $${topCandidate.arbitrageSpread.toFixed(2)}, below the execution threshold.`
      );
    } else {
      rationale.push("Held the slot because no eligible bid survived timeout and quality filters.");
    }

    return rationale;
  }
}

export const arbitrageEngine = new ArbitrageEngine();
