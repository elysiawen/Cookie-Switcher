/**
 * 开发期同时监听两份构建：
 * 主构建（popup / options / background）与 content script 的 IIFE 构建。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

const runs = [
  ['build', '--watch'],
  ['build', '--config', 'vite.content.config.ts', '--watch'],
];

const children = runs.map((args) =>
  spawn(process.execPath, [viteBin, ...args], { cwd: root, stdio: 'inherit' }),
);

children.forEach((child) => {
  child.on('exit', (code) => {
    if (code) process.exitCode = code;
  });
});

const shutdown = () => {
  for (const child of children) child.kill();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
