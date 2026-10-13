/**
 * Twitch IRC Chat Worker
 *
 * Connects to Twitch IRC, listens for chat messages,
 * and relays them to the 熾台 chat API.
 *
 * Usage: npx tsx src/twitch-worker.ts
 * Requires: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, CHAT_WORKER_KEY in .env
 */

import { PrismaClient } from "./generated/prisma/index.js";
import tmi from "tmi.js";

const prisma = new PrismaClient();
const API_BASE = process.env.API_BASE || "http://localhost:3000";
const CHAT_WORKER_KEY = process.env.CHAT_WORKER_KEY || "dev-key";

async function refreshTwitchToken(conn: any): Promise<string | null> {
  if (!conn.refreshToken) return conn.accessToken;
  try {
    const res = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID || "",
        client_secret: process.env.TWITCH_CLIENT_SECRET || "",
        refresh_token: conn.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (res.ok) {
      const data: any = await res.json();
      await prisma.platformConnection.update({
        where: { id: conn.id },
        data: {
          accessToken: data.access_token,
          refreshToken: data.refresh_token || conn.refreshToken,
          tokenExpiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
        },
      });
      return data.access_token;
    }
  } catch (e) {
    console.error("Failed to refresh Twitch token:", e);
  }
  return null;
}

async function postMessage(conn: any, user: string, message: string, isOwner: boolean) {
  try {
    await fetch(`${API_BASE}/api/v1/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: CHAT_WORKER_KEY,
        platform: "twitch",
        channelName: conn.channelName,
        userName: user,
        message,
        isOwner,
      }),
    });
  } catch {
    /* ignore */
  }
}

async function main() {
  const conn = await prisma.platformConnection.findFirst({
    where: { platform: "twitch", connected: true },
  });
  if (!conn || !conn.channelName || !conn.accessToken) {
    console.log("No Twitch connection found. Exiting.");
    await prisma.$disconnect();
    return;
  }

  let token = conn.accessToken;
  if (conn.tokenExpiresAt && new Date(conn.tokenExpiresAt) < new Date()) {
    const newToken = await refreshTwitchToken(conn);
    if (newToken) token = newToken;
  }

  console.log(`Connecting to Twitch IRC as ${conn.channelName}...`);

  const client = new tmi.Client({
    identity: { username: conn.channelName.toLowerCase(), password: `oauth:${token}` },
    channels: [conn.channelName.toLowerCase()],
  });

  client.on("connected", () => console.log(`✅ Connected to #${conn.channelName}`));
  client.on("disconnected", () => console.log("Disconnected, reconnecting in 10s..."));
  client.on("message", (_channel: string, tags: tmi.ChatUserstate, message: string, self: boolean) => {
    if (self) return;
    postMessage(conn, tags["display-name"] || tags.username || "Unknown", message, tags.badges?.broadcaster === "1");
  });

  try {
    await client.connect();
  } catch (e) {
    console.error("Failed to connect to Twitch IRC:", e);
  }

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    client.disconnect();
    await prisma.$disconnect();
    process.exit(0);
  });
}

main();
