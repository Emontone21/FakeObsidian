#!/usr/bin/env node
/**
 * Transporte stdio del MCP: es el que usan Claude Desktop y Claude Code.
 * Proceso local, sin autenticacion.
 *
 * IMPORTANTE: stdout pertenece al protocolo JSON-RPC. Cualquier mensaje
 * nuestro va a stderr, nunca a stdout.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createApp } from '../bootstrap.js';
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from './server.js';

async function main(): Promise<void> {
  const app = createApp();
  const server = createMcpServer(app.services);

  const shutdown = () => {
    app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(new StdioServerTransport());
  process.stderr.write(`[${SERVER_NAME} ${SERVER_VERSION}] MCP stdio conectado. Base: ${app.config.dbPath}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`[${SERVER_NAME}] no pudo arrancar: ${(error as Error).message}\n`);
  process.exit(1);
});
