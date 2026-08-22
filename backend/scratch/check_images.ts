const checkList = [
  'https://images.unsplash.com/photo-1518020382113-a7e8fc38eac9?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1606744824163-985d376605aa?w=800&auto=format&fit=crop'
];

async function check() {
  console.log('Checking final 2 alternative Unsplash URLs...');
  for (const url of checkList) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      console.log(`[STATUS ${res.status}] ${url}`);
    } catch (err: any) {
      console.log(`[BAD] Error ${err.message}: ${url}`);
    }
  }
  console.log('Check finished.');
}

check();
