import { IncomingMessage, ServerResponse } from "node:http";
import { auctionEngine } from "../auctions/AuctionEngine";
import { AuctionBidRequestSchema } from "../lib/validation";
import { withAuth } from "../middleware/auth";

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

const parseCampaignRoute = (url: string | undefined): { campaignId: string; action: "bid" | "winner" } | null => {
  if (!url) {
    return null;
  }

  const match = url.match(/^\/api\/v1\/auctions\/([^/]+)\/(bid|winner)$/);
  return match ? { campaignId: decodeURIComponent(match[1]), action: match[2] as "bid" | "winner" } : null;
};

export const handleAuctionBid = withAuth(async (req: IncomingMessage, res: ServerResponse) => {
  const route = parseCampaignRoute(req.url);

  if (!route || route.action !== "bid") {
    sendJson(res, 404, { error: "Auction route not found" });
    return;
  }

  const raw = await readJson(req);
  const parsed = AuctionBidRequestSchema.safeParse(raw);

  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    sendJson(res, 422, { error: "Validation failed", details: errors });
    return;
  }

  sendJson(res, 200, auctionEngine.placeBid(route.campaignId, parsed.data));
});

export const handleAuctionWinner = withAuth(async (req: IncomingMessage, res: ServerResponse) => {
  const route = parseCampaignRoute(req.url);

  if (!route || route.action !== "winner") {
    sendJson(res, 404, { error: "Auction route not found" });
    return;
  }

  sendJson(res, 200, auctionEngine.getWinner(route.campaignId));
});
