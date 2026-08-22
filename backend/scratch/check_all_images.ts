import * as fs from 'fs';
import * as path from 'path';

const seedFilePath = path.join(__dirname, '../prisma/seed.ts');

async function checkAll() {
  const content = fs.readFileSync(seedFilePath, 'utf8');
  const lines = content.split('\n');
  const urls: { url: string; line: number; title: string }[] = [];
  
  let currentTitle = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const titleMatch = /title:\s*'([^']+)'/.exec(line);
    if (titleMatch) {
      currentTitle = titleMatch[1];
    }
    const m = /imageUrl:\s*'([^']+)'/.exec(line);
    if (m) {
      urls.push({ url: m[1], line: i + 1, title: currentTitle });
    }
  }

  console.log(`Checking ${urls.length} image URLs...`);
  let brokenCount = 0;
  for (const item of urls) {
    try {
      const res = await fetch(item.url, { method: 'HEAD' });
      if (res.status !== 200) {
        console.log(`[BAD] Line ${item.line} | Title: "${item.title}" | Status ${res.status}: ${item.url}`);
        brokenCount++;
      }
    } catch (err: any) {
      console.log(`[BAD] Line ${item.line} | Title: "${item.title}" | Error ${err.message}: ${item.url}`);
      brokenCount++;
    }
  }
  console.log(`Check finished. Found ${brokenCount} broken URLs.`);
}

checkAll();
