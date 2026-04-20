import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { sign } from "jsonwebtoken";
import { app } from "../src/server";

const JWT_SECRET = process.env["QUANTMAIL_JWT_SECRET"] ?? "dev-secret-change-in-production";

const makeToken = (sub: string): string =>
  sign({ sub, iss: "quantmail" }, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: 3600
  });

const buildPayload = (auctionId: string, slotId: string, baseOutcomePrice: number) => ({
  advertiserId: "yield-team",
  auctionId,
  slotId,
  baseOutcomePrice,
  timeoutBudgetMs: 10,
  audience: {
    verifiedLtv: 148,
    intentScore: 0.84,
    conversionRate: 0.37,
    recencyMultiplier: 1.06,
    attentionScore: 0.88
  },
  pulse: {
    attentionDepth: 0.91,
    cognitiveLoad: 0.28,
    dwellTimeMs: 12400,
    eyeAlignment: 0.87,
    scrollVelocity: 0.24
  },
  slot: {
    platform: "quantedits",
    placementPath: "editor.export.sidebar",
    adFormat: "video",
    floorCpm: 8,
    viewabilityEstimate: 0.94,
    preferredCreativeStyle: "narrative"
  },
  bids: [
    {
      bidId: `${auctionId}-slow-high`,
      bidderId: "dsp-raw-cpm-max",
      campaignId: "cmp-raw-cpm-max",
      creativeId: "creative-raw-cpm-max",
      creativeStyle: "micro-burst",
      bidCpm: 34,
      responseLatencyMs: 12.4,
      predictedCtr: 0.41,
      predictedConversionRate: 0.18,
      qualityScore: 0.92,
      attentionAffinity: 0.7
    },
    {
      bidId: `${auctionId}-winner`,
      bidderId: "dsp-yield-alpha",
      campaignId: "cmp-yield-alpha",
      creativeId: "creative-yield-alpha",
      creativeStyle: "narrative",
      bidCpm: 22,
      responseLatencyMs: 6.1,
      predictedCtr: 0.38,
      predictedConversionRate: 0.42,
      qualityScore: 0.95,
      attentionAffinity: 0.94
    },
    {
      bidId: `${auctionId}-backup`,
      bidderId: "dsp-backup-beta",
      campaignId: "cmp-backup-beta",
      creativeId: "creative-backup-beta",
      creativeStyle: "native-card",
      bidCpm: 18,
      responseLatencyMs: 4.8,
      predictedCtr: 0.32,
      predictedConversionRate: 0.21,
      qualityScore: 0.86,
      attentionAffinity: 0.82
    }
  ]
});

test("yield arbitrage API selects the highest spread bid and exposes dashboard data", async () => {
  const token = makeToken("yield-ops");
  const server = app.listen(0);

  try {
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected numeric port");
    }

    const firstResponse = await fetch(`http://127.0.0.1:${address.port}/api/v1/yield/arbitrage/evaluate`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(buildPayload("yield-auction-001", "slot-a", 26))
    });
    assert.equal(firstResponse.status, 200);
    const firstBody = (await firstResponse.json()) as {
      decision: string;
      selectedBid: { bidderId: string; creativeStyle: string; timedOut: boolean; arbitrageSpread: number } | null;
      summary: { timedOutBidCount: number; eligibleBidCount: number };
      rationale: string[];
    };
    assert.equal(firstBody.decision, "execute");
    assert.equal(firstBody.selectedBid?.bidderId, "dsp-yield-alpha");
    assert.equal(firstBody.selectedBid?.creativeStyle, "narrative");
    assert.equal(firstBody.selectedBid?.timedOut, false);
    assert.ok((firstBody.selectedBid?.arbitrageSpread ?? 0) > 0);
    assert.equal(firstBody.summary.timedOutBidCount, 1);
    assert.equal(firstBody.summary.eligibleBidCount, 2);
    assert.equal(firstBody.rationale.length >= 3, true);

    const secondResponse = await fetch(`http://127.0.0.1:${address.port}/api/v1/yield/arbitrage/evaluate`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(buildPayload("yield-auction-002", "slot-b", 24))
    });
    assert.equal(secondResponse.status, 200);

    const summaryResponse = await fetch(`http://127.0.0.1:${address.port}/api/v1/yield/dashboard`, {
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    assert.equal(summaryResponse.status, 200);
    const summaryBody = (await summaryResponse.json()) as {
      summary: { totalAuctions: number; executedAuctions: number; timeoutRate: number; averageYieldSpread: number };
      bidderLeaderboard: Array<{ bidderId: string; wins: number }>;
      formatMix: Array<{ creativeStyle: string; wins: number }>;
      recentAuctions: Array<{ auctionId: string; decision: string }>;
    };
    assert.equal(summaryBody.summary.totalAuctions >= 2, true);
    assert.equal(summaryBody.summary.executedAuctions >= 2, true);
    assert.ok(summaryBody.summary.timeoutRate > 0);
    assert.ok(summaryBody.summary.averageYieldSpread > 0);
    assert.equal(summaryBody.bidderLeaderboard[0]?.bidderId, "dsp-yield-alpha");
    assert.equal(summaryBody.formatMix[0]?.creativeStyle, "narrative");
    assert.equal(summaryBody.recentAuctions[0]?.decision, "execute");

    const pageResponse = await fetch(`http://127.0.0.1:${address.port}/internal/yield-dashboard`, {
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    assert.equal(pageResponse.status, 200);
    const html = await pageResponse.text();
    assert.match(html, /Quantads Yield Dashboard/);
    assert.match(html, /expected spread, not raw CPM/);
    assert.match(html, /\/api\/v1\/yield\/dashboard/);
  } finally {
    server.close();
  }
});
