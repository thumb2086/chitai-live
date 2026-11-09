/**
 * Service Discovery Endpoint
 * 
 * Provides a centralized service registry for inter-service communication.
 * Deployed at /.well-known/services.json
 */

import { Hono } from 'hono';

const app = new Hono();

// Service Registry - Single source of truth for all services
const SERVICE_REGISTRY = {
  version: "1.0",
  updatedAt: new Date().toISOString(),
  services: {
    "zixi-earth": {
      name: "zixi-earth",
      displayName: "Zixi Earth Game Backend",
      baseUrl: "https://zixiearth.dpdns.org",
      apiBaseUrl: "https://zixiearth.dpdns.org/api",
      healthEndpoint: "/health",
      description: "Core game backend: companies, stocks, mining, casino, wallet",
      version: "1.0.0",
      capabilities: [
        "company-management",
        "stock-trading",
        "margin-trading",
        "futures",
        "etf",
        "mining",
        "casino-games",
        "wallet",
        "investment",
        "employee-management"
      ],
      auth: {
        type: "jwt",
        issuer: "zixi-ecosystem",
        audience: "zixi-services"
      },
      rateLimits: {
        requestsPerMinute: 100,
        burst: 20
      },
      circuitBreaker: {
        enabled: true,
        threshold: 5,
        resetMs: 30000
      },
      compression: ["gzip", "br"],
      regions: ["apac"],
      maintainer: "zixi-team"
    },
    "groq-router": {
      name: "groq-router",
      displayName: "Groq Router LLM Gateway",
      baseUrl: "https://api.groq-router.vercel.app",
      apiBaseUrl: "https://api.groq-router.vercel.app",
      healthEndpoint: "/health",
      description: "LLM Gateway with Groq/NVIDIA keys, rate limiting, key management",
      version: "1.0.0",
      capabilities: [
        "chat-completion",
        "models-list",
        "usage-tracking",
        "key-management",
        "admin-panel"
      ],
      auth: {
        type: "api-key",
        header: "X-API-Key"
      },
      rateLimits: {
        requestsPerMinute: 60,
        burst: 10
      },
      circuitBreaker: {
        enabled: true,
        threshold: 3,
        resetMs: 60000
      },
      compression: ["gzip", "br"],
      regions: ["global"],
      maintainer: "zixi-team"
    },
    "chitai-live-api": {
      name: "chitai-live-api",
      displayName: "Chitai Live Streaming API",
      baseUrl: "https://api.zixilive.dpdns.org",
      apiBaseUrl: "https://api.zixilive.dpdns.org",
      healthEndpoint: "/health",
      description: "Streaming dashboard backend: streams, chat, donations, auth",
      version: "1.0.0",
      capabilities: [
        "stream-management",
        "chat",
        "donations",
        "user-management",
        "notifications",
        "overlays"
      ],
      auth: {
        type: "jwt",
        issuer: "zixi-ecosystem",
        audience: "zixi-services"
      },
      rateLimits: {
        requestsPerMinute: 100,
        burst: 20
      },
      circuitBreaker: {
        enabled: true,
        threshold: 5,
        resetMs: 30000
      },
      compression: ["gzip", "br"],
      regions: ["apac"],
      maintainer: "zixi-team"
    },
    "chitai-live-web": {
      name: "chitai-live-web",
      displayName: "Chitai Live Dashboard",
      baseUrl: "https://zixilive.dpdns.org",
      healthEndpoint: "/",
      description: "Streaming dashboard frontend (static export)",
      version: "1.0.0",
      capabilities: [
        "stream-dashboard",
        "chat-ui",
        "donation-alerts",
        "settings"
      ],
      auth: {
        type: "jwt",
        issuer: "zixi-ecosystem",
        audience: "zixi-services"
      },
      rateLimits: {
        requestsPerMinute: 200,
        burst: 50
      },
      compression: ["gzip", "br"],
      regions: ["apac"],
      maintainer: "zixi-team"
    },
    "groq-router-web": {
      name: "groq-router-web",
      displayName: "Groq Router Dashboard",
      baseUrl: "https://groq-router.vercel.app",
      healthEndpoint: "/",
      description: "Groq Router management dashboard",
      version: "1.0.0",
      capabilities: [
        "key-management",
        "usage-analytics",
        "model-comparison"
      ],
      compression: ["gzip", "br"],
      regions: ["global"],
      maintainer: "zixi-team"
    }
  },
  // Cross-service communication patterns
  communicationPatterns: {
    "zixi-earth -> groq-router": {
      pattern: "async-request",
      useCase: "AI bot decisions, caption generation, content moderation",
      auth: "api-key",
      timeout: "30s",
      retry: 2,
      circuitBreaker: true
    },
    "zixi-earth -> chitai-live-api": {
      pattern: "sync-request",
      useCase: "Stream notifications, donation alerts, user sync",
      auth: "jwt",
      timeout: "5s",
      retry: 3,
      circuitBreaker: true
    },
    "chitai-live-web -> chitai-live-api": {
      pattern: "sync-request",
      useCase: "All dashboard operations",
      auth: "jwt",
      timeout: "10s",
      retry: 3,
      circuitBreaker: true
    },
    "chitai-live-web -> zixi-earth": {
      pattern: "sync-request",
      useCase: "OAuth login, wallet linking, company data",
      auth: "oauth2 + jwt",
      timeout: "10s",
      retry: 3,
      circuitBreaker: true
    },
    "chitai-live-web -> groq-router": {
      pattern: "async-request",
      useCase: "AI captions, content generation",
      auth: "api-key",
      timeout: "30s",
      retry: 2,
      circuitBreaker: true
    },
    "zixi-wallet-app -> zixi-earth": {
      pattern: "sync-request",
      useCase: "Device Linker protocol, wallet ops",
      auth: "device-linker-signature",
      timeout: "15s",
      retry: 3,
      circuitBreaker: true
    }
  },
  // Shared configuration
  shared: {
    jwt: {
      issuer: "zixi-ecosystem",
      audience: "zixi-services",
      algorithm: "HS256",
      accessTokenTtl: "15m",
      refreshTokenTtl: "30d"
    },
    cors: {
      allowedOrigins: [
        "https://zixilive.dpdns.org",
        "https://zixiearth.dpdns.org",
        "https://groq-router.vercel.app",
        "https://master.livestream-dashboard-cs8.pages.dev",
        "http://localhost:3000",
        "http://localhost:5173"
      ],
      allowedMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Idempotency-Key", "Traceparent"],
      credentials: true
    },
    tracing: {
      enabled: true,
      headerName: "traceparent",
      format: "w3c",
      sampleRate: 0.1
    },
    compression: {
      enabled: true,
      algorithms: ["br", "gzip"],
      minSize: 1024
    },
    cache: {
      defaultTtl: 30000,
      staleWhileRevalidate: 300000,
      tags: ["user", "stream", "company", "stock", "leaderboard", "config"]
    }
  }
};

// Export for use in Workers
export const SERVICE_REGISTRY = SERVICE_REGISTRY;

// Hono route for service discovery
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const discoveryApp = new Hono();

discoveryApp.use('*', cors({
  origin: [
    'https://zixilive.dpdns.org',
    'https://zixiearth.dpdns.org',
    'https://groq-router.vercel.app',
    'https://master.livestream-dashboard-cs8.pages.dev',
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'OPTIONS'],
  credentials: true
}));

// Main service registry endpoint
discoveryApp.get('/.well-known/services.json', (c) => {
  return c.json(SERVICE_REGISTRY, {
    headers: {
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
      'Content-Type': 'application/json'
    }
  });
});

// Health check for all registered services
discoveryApp.get('/.well-known/services/health', async (c) => {
  const results = await Promise.allSettled(
    Object.entries(SERVICE_REGISTRY.services).map(async ([key, service]) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${service.apiBaseUrl}${service.healthEndpoint}`, {
          signal: controller.signal,
          headers: { 'Accept': 'application/json' }
        });
        clearTimeout(timeout);
        return { service: key, healthy: res.ok, status: res.status };
      } catch (error) {
        return { service: key, healthy: false, error: error.message };
      }
    })
  );

  const health = results.map(r => r.status === 'fulfilled' ? r.value : { service: 'unknown', healthy: false, error: r.reason?.message });
  
  return c.json({
    overall: health.every(h => h.healthy) ? 'healthy' : 'degraded',
    services: health,
    timestamp: new Date().toISOString()
  });
});

// Get specific service info
discoveryApp.get('/.well-known/services/:name', (c) => {
  const name = c.req.param('name');
  const service = SERVICE_REGISTRY.services[name as keyof typeof SERVICE_REGISTRY.services];
  
  if (!service) {
    return c.json({ error: 'Service not found' }, 404);
  }
  
  return c.json(service);
});

// Service communication patterns
discoveryApp.get('/.well-known/services/patterns', (c) => {
  return c.json(SERVICE_REGISTRY.communicationPatterns);
});

// Shared config
discoveryApp.get('/.well-known/services/shared', (c) => {
  return c.json(SERVICE_REGISTRY.shared);
});

export default discoveryApp;