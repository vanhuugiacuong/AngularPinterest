const checkList = [
  // K-Pop (25)
  'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1545128485-c400e7702796?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1554151228-14d9def656e4?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1488161628813-04466f872be2?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1513829096960-ef093143c586?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1519345182560-3f2917c472ef?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1503023345310-bd7c1de61c7d?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1518806118471-f28b20a1d79d?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1519741497674-611481863552?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&auto=format&fit=crop',

  // Drawing (25)
  'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1580136579312-94651dfd596d?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1579783928621-7a13d66a62d1?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1605721911519-3dfeb3be25e7?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1544816155-12df9643f363?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1515462277126-270d878326e5?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1576016770956-debb63d900ad?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1501472312651-726afd116ff1?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1579783928591-8d26dfa7852c?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1547891654-e66ed7edd96c?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1579783928642-78d12efde384?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1459908272690-6677bc76244f?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1513542789411-b6a5d4f31634?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1579783928598-a83d3ff69bb6?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1536924940846-227afb31e2a5?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1579783928646-dfbdfeb9965d?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1579783928584-6f0148186f9f?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1608962714026-ae8a73229b4e?w=800&auto=format&fit=crop',

  // Anime (25)
  'https://images.unsplash.com/photo-1528164344705-47542687000d?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1540959733332-eab4deceeaf7?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1524413840003-0c3cbd6fcb55?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1504618223053-559bdef9dd5a?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1563089145-599997674d42?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1566241440091-ec10de8db2e1?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1534972195531-d756b9bda9f2?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1542831371-29b0f74f9713?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1601987177651-8edfe6c20009?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1529251786756-7c22f2af268a?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1573164713988-8665fc963095?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&auto=format&fit=crop',

  // Meme (25)
  'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1573865526739-10659fec78a5?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1533738363-b7f9aef128ce?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1534361960057-19889db9621e?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1518020382113-a7e8fc38eac9?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1504208434309-cb69f4fe52b0?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1455218873509-8097305ee378?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1518887570146-0612132dd618?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1571752726703-5e7d1f6a986d?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1596492784531-6e6eb5ea9993?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1530281700549-e82e7bf110d6?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1507146426996-ef05306b995a?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1518717758536-85ae29035b6d?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1561037404-61cd46aa615b?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1503256207526-0d5d80fa2f47?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1472491235688-bdc81a63246e?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1526336024174-e58f5cdd8e13?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1574158622643-69d34d72650a?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1537151625747-7ae85efd68c4?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1516467508483-a7212febe31a?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1589182373726-e4f658ab50f0?w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1572859578277-590d64cc1cb5?w=800&auto=format&fit=crop'
];

async function check() {
  console.log(`Checking ${checkList.length} new Unsplash image URLs...`);
  let bad = 0;
  for (const url of checkList) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.status !== 200) {
        console.log(`[BAD] Status ${res.status}: ${url}`);
        bad++;
      }
    } catch (err: any) {
      console.log(`[BAD] Error ${err.message}: ${url}`);
      bad++;
    }
  }
  console.log(`Check finished. Found ${bad} broken URLs.`);
}

check();
