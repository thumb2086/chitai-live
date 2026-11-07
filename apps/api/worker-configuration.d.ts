// Cloudflare Workers 類型聲明
/// <reference types="@cloudflare/workers-types" />

declare module '@cloudflare/workers-types' {
  interface D1Database {
    prepare(query: string): D1PreparedStatement;
    exec(query: string): Promise<D1ExecResult>;
    dump(): Promise<ArrayBuffer>;
  }

  interface D1PreparedStatement {
    bind(...values: any[]): D1PreparedStatement;
    first<T = any>(colName?: string): Promise<T | null>;
    all<T = any>(): Promise<D1Result<T>>;
    run(): Promise<D1ExecResult>;
    raw<T = any>(): Promise<T[]>;
  }

  interface D1Result<T = any> {
    results: T[];
    success: boolean;
    meta: {
      duration: number;
      rows_read: number;
      rows_written: number;
    };
  }

  interface D1ExecResult {
    count: number;
    duration: number;
  }

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
  DB: D1Database;
  KV: KVNamespace;
  JWT_SECRET: string;
  ENVIRONMENT: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
}