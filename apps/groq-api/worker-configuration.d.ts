// Cloudflare Workers 類型聲明
/// <reference types="@cloudflare/workers-types" />

declare module '@cloudflare/workers-types' {
  interface KVNamespace {
    get(key: string, type?: 'text' | 'json' | 'arrayBuffer' | 'stream'): Promise<any>;
    put(key: string, value: string | ReadableStream | ArrayBuffer, options?: KVNamespacePutOptions): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: KVNamespaceListOptions): Promise<KVNamespaceListResult>;
    getWithMetadata(key: string, type?: 'text' | 'json' | 'arrayBuffer' | 'stream'): Promise<KVNamespaceGetWithMetadataResult<any> | null>;
  }

  interface KVNamespacePutOptions {
    expirationTtl?: number;
    expiration?: number;
    metadata?: any;
  }

  interface KVNamespaceListOptions {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }

  interface KVNamespaceListResult {
    keys: KVNamespaceListKey[];
    list_complete: boolean;
    cursor?: string;
  }

  interface KVNamespaceListKey {
    name: string;
    expiration?: number;
    metadata?: any;
  }

  interface KVNamespaceGetWithMetadataResult<T> {
    value: T;
    metadata: any;
  }
}

// 環境變數類型
interface Env {
  KV: KVNamespace;
  GROQ_KEYS: string;
  NVIDIA_API_KEY: string;
  ROUTER_TOKEN: string;
  ADMIN_TOKEN: string;
  ENVIRONMENT: string;
}