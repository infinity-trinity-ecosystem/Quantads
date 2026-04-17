import { IncomingMessage, ServerResponse } from "node:http";
import { hfbExchange } from "../exchange/HFBExchange";
import { withAuth } from "../middleware/auth";
import { HFBBidSchema } from "../lib/validation";
import { logger } from "../lib/logger";

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const readJson = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
};

/**
 * POST /api/v1/exchange/bid
 *
 * Submits a high-frequency bid to the in-process exchange ring buffer.
 * Returns the assigned stream ID (mirrors Redis Stream entry ID format).
 * If the buffer is full (back-pressure), returns 429.
 *
 * Immediately drains a small batch after submission so tests can observe
 * clearing results synchronously.
 */
export const handleExchangeBid = withAuth(async (req: IncomingMessage, res: ServerResponse) => {
  const raw = await readJson(req);
  const parsed = HFBBidSchema.safeParse(raw);

  if (!parsed.success) {
    const errors = parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
    logger.warn({ errors }, "exchange bid validation failed");
    sendJson(res, 422, { error: "Validation failed", details: errors });
    return;
  }

  const bid = {
    ...parsed.data,
    submittedAt: new Date().toISOString()
  };

  const streamId = hfbExchange.submit(bid);

  if (streamId === null) {
    sendJson(res, 429, { error: "Exchange buffer full – retry later" });
    return;
  }

  logger.debug({ streamId, adSlotId: bid.adSlotId }, "exchange bid submitted");

  // Eagerly drain a batch so the result is available without a separate call
  const cleared = hfbExchange.drain(64);

  sendJson(res, 200, { streamId, cleared });
});

/**
 * GET /api/v1/exchange/stats
 *
 * Returns throughput and buffer statistics for the exchange.
 */
export const handleExchangeStats = withAuth(async (_req: IncomingMessage, res: ServerResponse) => {
  sendJson(res, 200, hfbExchange.stats());
});
