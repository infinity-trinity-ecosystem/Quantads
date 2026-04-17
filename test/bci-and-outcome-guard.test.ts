import test, { after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { sign } from "jsonwebtoken";
import { app } from "../src/server";
import { BciAttentionStore } from "../src/bci/AttentionStore";
import { OutcomeStore } from "../src/lib/outcome-store";

const JWT_SECRET = process.env["QUANTMAIL_JWT_SECRET"] ?? "dev-secret-change-in-production";

function makeToken(sub = "bci-user-001", expiresIn = 3600): string {
  return sign({ sub, iss: "quantmail" }, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn
  });
}

// ── BciAttentionStore unit tests ──────────────────────────────────────────────

test("BciAttentionStore ingests a signal and computes a compositeScore", () => {
  const store = new BciAttentionStore();
  const record = store.ingest({
    userId: "u1",
    sessionId: "s1",
    platform: "quanttube",
    attentionScore: 0.8,
    engagementScore: 0.6,
    focusScore: 0.5
  });

  assert.ok(record.signalId.length > 0);
  assert.equal(record.userId, "u1");
  assert.ok(record.compositeScore > 0 && record.compositeScore <= 1);
});

test("BciAttentionStore returns null aggregation for unknown user", () => {
  const store = new BciAttentionStore();
  assert.equal(store.getAggregated("nobody"), null);
});

test("BciAttentionStore aggregates multiple signals correctly", () => {
  const store = new BciAttentionStore();
  store.ingest({ userId: "u2", sessionId: "s1", platform: "quantedits", attentionScore: 0.4, engagementScore: 0.4, focusScore: 0.4 });
  store.ingest({ userId: "u2", sessionId: "s1", platform: "quantedits", attentionScore: 0.8, engagementScore: 0.8, focusScore: 0.8, adExposureMs: 2000 });

  const agg = store.getAggregated("u2");
  assert.ok(agg !== null);
  assert.equal(agg.sampleCount, 2);
  assert.equal(agg.averageAttention, 0.6);
  assert.equal(agg.totalAdExposureMs, 2000);
});

// ── OutcomeStore duplicate guard unit tests ───────────────────────────────────

test("OutcomeStore rejects duplicate transactionHash for same invoice", () => {
  const store = new OutcomeStore();
  store.registerInvoice({
    invoiceId: "inv-1",
    campaignId: "cmp-1",
    advertiserId: "adv-1",
    agencyId: "agency-1",
    outcomeType: "app-install",
    quotedOutcomeCount: 5,
    unitPrice: 2,
    quotedAmount: 10,
    paymentStatus: "quoted",
    settledAmount: null
  });

  store.recordOutcome({
    invoiceId: "inv-1",
    outcomeType: "app-install",
    outcomeCount: 1,
    valueGenerated: 5,
    verifier: "v1",
    transactionHash: "0xdeadbeef"
  });

  assert.throws(
    () =>
      store.recordOutcome({
        invoiceId: "inv-1",
        outcomeType: "app-install",
        outcomeCount: 1,
        valueGenerated: 5,
        verifier: "v1",
        transactionHash: "0xdeadbeef"
      }),
    /already been recorded/
  );
});

test("OutcomeStore allows distinct transactionHash values on the same invoice", () => {
  const store = new OutcomeStore();
  store.registerInvoice({
    invoiceId: "inv-2",
    campaignId: "cmp-2",
    advertiserId: "adv-2",
    agencyId: "agency-2",
    outcomeType: "purchase",
    quotedOutcomeCount: 5,
    unitPrice: 3,
    quotedAmount: 15,
    paymentStatus: "quoted",
    settledAmount: null
  });

  store.recordOutcome({
    invoiceId: "inv-2",
    outcomeType: "purchase",
    outcomeCount: 1,
    valueGenerated: 10,
    verifier: "v1",
    transactionHash: "0xhash-a"
  });

  const ledger = store.recordOutcome({
    invoiceId: "inv-2",
    outcomeType: "purchase",
    outcomeCount: 1,
    valueGenerated: 10,
    verifier: "v1",
    transactionHash: "0xhash-b"
  });

  assert.equal(ledger.reportedOutcomeCount, 2);
});

// ── BCI HTTP API integration tests ───────────────────────────────────────────

test("POST /api/v1/bci/attention ingests a signal and returns 201", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/bci/attention`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${makeToken()}`
      },
      body: JSON.stringify({
        userId: "bci-user-001",
        sessionId: "sess-001",
        platform: "quanttube",
        campaignId: "cmp-travel-gear-001",
        attentionScore: 0.75,
        engagementScore: 0.65,
        focusScore: 0.55,
        adExposureMs: 3500
      })
    });

    assert.equal(response.status, 201);

    const body = await response.json() as {
      signalId: string;
      compositeScore: number;
      userId: string;
      sessionId: string;
    };

    assert.ok(typeof body.signalId === "string" && body.signalId.length > 0);
    assert.ok(body.compositeScore > 0);
    assert.equal(body.userId, "bci-user-001");
    assert.equal(body.sessionId, "sess-001");
  } finally {
    server.close();
  }
});

test("POST /api/v1/bci/attention returns 401 without JWT", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/bci/attention`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "u1",
        sessionId: "s1",
        platform: "quanttube",
        attentionScore: 0.5,
        engagementScore: 0.5,
        focusScore: 0.5
      })
    });

    assert.equal(response.status, 401);
  } finally {
    server.close();
  }
});

test("POST /api/v1/bci/attention returns 422 on invalid input", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/bci/attention`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${makeToken()}`
      },
      body: JSON.stringify({
        userId: "u1",
        sessionId: "s1",
        platform: "unknown-platform",  // invalid enum
        attentionScore: 1.5,           // out of range
        engagementScore: 0.5,
        focusScore: 0.5
      })
    });

    assert.equal(response.status, 422);
    const body = await response.json() as { error: string; details: string[] };
    assert.equal(body.error, "Validation failed");
    assert.ok(Array.isArray(body.details) && body.details.length > 0);
  } finally {
    server.close();
  }
});

test("GET /api/v1/bci/attention/:userId/aggregated returns aggregated metrics", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");

    const token = makeToken("agg-user-001");
    const authHeaders = {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    };

    // Ingest two signals so aggregation has data
    await fetch(`http://127.0.0.1:${address.port}/api/v1/bci/attention`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        userId: "agg-user-001",
        sessionId: "sess-agg-1",
        platform: "quantedits",
        attentionScore: 0.6,
        engagementScore: 0.7,
        focusScore: 0.5,
        adExposureMs: 1000
      })
    });

    await fetch(`http://127.0.0.1:${address.port}/api/v1/bci/attention`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        userId: "agg-user-001",
        sessionId: "sess-agg-2",
        platform: "quantedits",
        attentionScore: 0.8,
        engagementScore: 0.9,
        focusScore: 0.7,
        adExposureMs: 2000
      })
    });

    const aggResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/bci/attention/agg-user-001/aggregated`,
      { method: "GET", headers: { authorization: `Bearer ${token}` } }
    );

    assert.equal(aggResponse.status, 200);

    const agg = await aggResponse.json() as {
      userId: string;
      sampleCount: number;
      averageAttention: number;
      totalAdExposureMs: number;
    };

    assert.equal(agg.userId, "agg-user-001");
    assert.equal(agg.sampleCount, 2);
    assert.equal(agg.averageAttention, 0.7);
    assert.equal(agg.totalAdExposureMs, 3000);
  } finally {
    server.close();
  }
});

test("GET /api/v1/bci/attention/:userId/aggregated returns 404 for unknown user", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/bci/attention/nobody/aggregated`,
      { method: "GET", headers: { authorization: `Bearer ${makeToken()}` } }
    );

    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});

after(() => {
  app.close();
});
