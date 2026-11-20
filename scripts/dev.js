// Cross-platform local development entry point (Windows, macOS, Linux).
process.env.DEV_MODE = '1';
process.env.HOST = '127.0.0.1';
await import('../src/server.js');
