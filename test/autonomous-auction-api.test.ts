import test, { after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { sign } from "jsonwebtoken";
import { app } from "../src/server";

const JWT_SECRET = process.env["QUANTMAIL_JWT_SECRET"] ?? "dev-secret-change-in-production";

function makeToken(sub = "auction-user-001", expiresIn = 3600): string {
  return sign({ sub, iss: "quantmail" }, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn
  });
}

test("auction workflow ranks bids, records outcomes, and updates analytics", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected numeric port");
    }

    const campaignId = "cmp-auction-api-001";
    const authHeaders = {
      "content-type": "application/json",
      authorization: `Bearer ${makeToken()}`
    };

    const winningResponse = await fetch(`http://127.0.0.1:${address.port}/api/v1/auctions/${campaignId}/bid`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        advertiserId: "adv-premium",
        agencyId: "agency-premium",
        outcomeType: "booked-meeting",
        baseOutcomePrice: 40,
        audience: {
          verifiedLtv: 220,
          intentScore: 0.92,
          conversionRate: 0.7,
          recencyMultiplier: 1.1
        },
        marketPressure: 1.1,
        outcomeCount: 5,
        settlementAddress: "0xpremium",
        settlementNetwork: "base",
        currency: "usdc",
        authorization: {
          payerWallet: "0xpremium-wallet",
          transactionHash: "0xtx-premium",
          amount: 1000,
          currency: "usdc"
        }
      })
    });

    assert.equal(winningResponse.status, 200);
    const winningBody = await winningResponse.json() as {
      invoiceId: string;
      isWinning: boolean;
      paymentStatus: string;
      leaderboard: Array<{ advertiserId: string }>;
    };

    assert.equal(winningBody.isWinning, true);
    assert.equal(winningBody.paymentStatus, "settled");
    assert.equal(winningBody.leaderboard[0]?.advertiserId, "adv-premium");

    const challengerResponse = await fetch(`http://127.0.0.1:${address.port}/api/v1/auctions/${campaignId}/bid`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        advertiserId: "adv-challenger",
        agencyId: "agency-challenger",
        outcomeType: "booked-meeting",
        baseOutcomePrice: 30,
        audience: {
          verifiedLtv: 110,
          intentScore: 0.6,
          conversionRate: 0.35
        },
        outcomeCount: 5,
        settlementAddress: "0xchallenger",
        settlementNetwork: "base",
        currency: "USDC"
      })
    });

    assert.equal(challengerResponse.status, 200);
    const challengerBody = await challengerResponse.json() as {
      rank: number;
      isWinning: boolean;
      recommendedBidToWin: number | null;
    };

    assert.equal(challengerBody.rank, 2);
    assert.equal(challengerBody.isWinning, false);
    assert.ok((challengerBody.recommendedBidToWin ?? 0) > 0);

    const outcomeReportResponse = await fetch(`http://127.0.0.1:${address.port}/api/v1/outcomes/report`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        invoiceId: winningBody.invoiceId,
        outcomeType: "booked-meeting",
        outcomeCount: 2,
        valueGenerated: 650,
        verifier: "quantsink-proof-engine",
        transactionHash: "0xproof-1"
      })
    });

    assert.equal(outcomeReportResponse.status, 200);
    const ledger = await outcomeReportResponse.json() as {
      reportedOutcomeCount: number;
      billableOutcomeCount: number;
      roas: number;
    };

    assert.equal(ledger.reportedOutcomeCount, 2);
    assert.equal(ledger.billableOutcomeCount, 2);
    assert.ok(ledger.roas > 0);

    const winnerLookupResponse = await fetch(`http://127.0.0.1:${address.port}/api/v1/auctions/${campaignId}/winner`, {
      method: "GET",
      headers: { authorization: `Bearer ${makeToken()}` }
    });

    assert.equal(winnerLookupResponse.status, 200);
    const winnerLookupBody = await winnerLookupResponse.json() as {
      winner: {
        advertiserId: string;
        delivery: { reportedOutcomeCount: number };
      } | null;
    };

    assert.equal(winnerLookupBody.winner?.advertiserId, "adv-premium");
    assert.equal(winnerLookupBody.winner?.delivery.reportedOutcomeCount, 2);

    const invoiceLookupResponse = await fetch(`http://127.0.0.1:${address.port}/api/v1/outcomes/${winningBody.invoiceId}`, {
      method: "GET",
      headers: { authorization: `Bearer ${makeToken()}` }
    });

    assert.equal(invoiceLookupResponse.status, 200);
    const invoiceLookupBody = await invoiceLookupResponse.json() as {
      invoiceId: string;
      reports: Array<{ verifier: string }>;
    };

    assert.equal(invoiceLookupBody.invoiceId, winningBody.invoiceId);
    assert.equal(invoiceLookupBody.reports[0]?.verifier, "quantsink-proof-engine");

    const analyticsResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/analytics/campaigns?campaignId=${campaignId}`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${makeToken()}` }
      }
    );

    assert.equal(analyticsResponse.status, 200);
    const analyticsBody = await analyticsResponse.json() as {
      summary: {
        recordedOutcomes: number;
        billableOutcomes: number;
        outcomeValueGenerated: number;
      };
    };

    assert.equal(analyticsBody.summary.recordedOutcomes, 2);
    assert.equal(analyticsBody.summary.billableOutcomes, 2);
    assert.equal(analyticsBody.summary.outcomeValueGenerated, 650);
  } finally {
    server.close();
  }
});

after(() => {
  app.close();
});
