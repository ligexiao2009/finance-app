#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const docsDir = path.join(projectRoot, 'docs');

const filesToCopy = [
  'index.html',
  'index-mobile.html',
  'app-config.js',
  'tailwind.generated.css',
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(fileName) {
  const sourcePath = path.join(publicDir, fileName);
  const targetPath = path.join(docsDir, fileName);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source file not found: ${sourcePath}`);
  }

  fs.copyFileSync(sourcePath, targetPath);
  console.log(`Synced ${fileName} -> docs/${fileName}`);
}

function main() {
  ensureDir(docsDir);

  filesToCopy.forEach(copyFile);

  console.log('Docs sync completed.');
}

main();
