import * as fs from 'fs';
import * as path from 'path';

const seedFilePath = path.join(__dirname, '../prisma/seed.ts');

function findDuplicates() {
  const content = fs.readFileSync(seedFilePath, 'utf8');
  const regex = /imageUrl:\s*'([^']+)'/g;
  let match;
  const urls: { url: string; line: number }[] = [];
  
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /imageUrl:\s*'([^']+)'/.exec(line);
    if (m) {
      urls.push({ url: m[1], line: i + 1 });
    }
  }

  const urlCounts: Record<string, { count: number; lines: number[] }> = {};
  for (const item of urls) {
    if (!urlCounts[item.url]) {
      urlCounts[item.url] = { count: 0, lines: [] };
    }
    urlCounts[item.url].count++;
    urlCounts[item.url].lines.push(item.line);
  }

  console.log('--- DUPLICATE IMAGE URLS IN SEED.TS ---');
  for (const [url, info] of Object.entries(urlCounts)) {
    if (info.count > 1) {
      console.log(`URL: ${url}`);
      console.log(`Count: ${info.count}`);
      console.log(`Lines: ${info.lines.join(', ')}`);
      console.log('--------------------------------------');
    }
  }
}

findDuplicates();
