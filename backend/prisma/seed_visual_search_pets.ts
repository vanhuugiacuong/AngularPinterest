/**
 * Seed a coherent set of dog and cat pins for the "search by image" (reverse
 * image search) demo.
 *
 * Why this file is separate from seed.ts / seed_new_pins.ts:
 *  - Visual search ranks every embedded pin by CLIP similarity. A dog query only
 *    looks convincing if there is a solid, clean block of dog photos to return
 *    (and likewise for cats). The old meme block mixed cats, dogs, alpaca, pig,
 *    monkey... in one category, so results came back mixed.
 *  - These pins belong to their own mock user (sample-user-id-pets) so re-running
 *    this script never touches any other account's data on the shared database.
 *
 * Every image URL here was checked with the CLIP service and classifies as the
 * intended subject. Captions share one voice: a short, light, first-person line.
 *
 * Run:  npx ts-node --transpile-only prisma/seed_visual_search_pets.ts
 * Needs the CLIP service running (CLIP_SERVICE_URL, default http://localhost:8001)
 * so each pin gets its vector embedding immediately.
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set in environment variables.');
  process.exit(1);
}
const clipServiceUrl = process.env.CLIP_SERVICE_URL || 'http://localhost:8001';

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PET_USER = {
  id: 'sample-user-id-pets',
  username: 'thu_cung_moi_ngay',
  email: 'pets@example.com',
  avatarUrl: 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&w=150',
  bio: 'Mỗi ngày một khoảnh khắc đáng yêu của các bé cún và bé mèo.',
};

type PetPin = { title: string; description: string; imageUrl: string; category: string };

const dogPins: PetPin[] = [
  ['Cún cười phá lên giữa buổi trưa', 'Cười phá lên khi nghe kể câu chuyện cười nhạt nhất hành tinh.', 'https://images.pexels.com/photos/144608/pexels-photo-144608.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Hai anh em ra sân nghịch đất', 'Rủ nhau ra sân nghịch đất, tối về kiểu gì cũng bị mắng một trận.', 'https://images.pexels.com/photos/15778742/pexels-photo-15778742.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Ngủ trưa ngoài nắng', 'Ngủ trưa ngoài nắng, giấc mơ toàn xúc xích với bóng tennis.', 'https://images.pexels.com/photos/16299046/pexels-photo-16299046.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Anh cả dẫn đàn em đi tuần', 'Anh cả dẫn đàn em đi một vòng khu phố cho quen đường về nhà.', 'https://images.pexels.com/photos/16629458/pexels-photo-16629458.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Rình xem bên kia hàng rào', 'Rình xem bên kia hàng rào có trò gì vui mà mình đang bị bỏ lỡ.', 'https://images.pexels.com/photos/18941334/pexels-photo-18941334.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Hai đứa ngồi ngoan chờ giờ ăn', 'Ngồi ngoan chờ tới giờ ăn, mắt không rời cái tủ lạnh một giây.', 'https://images.pexels.com/photos/20680840/pexels-photo-20680840.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Bạn thân cho dựa lúc buồn ngủ', 'Bạn thân là đứa chịu ngồi im cho mình dựa vào lúc buồn ngủ.', 'https://images.pexels.com/photos/29373007/pexels-photo-29373007.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Làm dáng chờ chụp hình', 'Ngồi làm dáng chờ chụp hình, có người lạ đi ngang phía sau cũng kệ.', 'https://images.pexels.com/photos/30074125/pexels-photo-30074125.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Chạy trên cát cả buổi chiều', 'Chạy trên cát nguyên buổi chiều mà vẫn chưa thấy đủ.', 'https://images.pexels.com/photos/31834468/pexels-photo-31834468.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Ngày nắng đẹp muốn lăn ra cỏ', 'Ngày nắng đẹp thế này chỉ muốn nằm lăn ra cỏ sưởi cái bụng.', 'https://images.pexels.com/photos/32080246/pexels-photo-32080246.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Vừa đào xong một cái hố bí mật', 'Vừa đào được một cái hố bí mật, không khai cho ai biết đâu.', 'https://images.pexels.com/photos/32113856/pexels-photo-32113856.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Mới ngủ dậy tóc tai dựng ngược', 'Mới ngủ dậy tóc tai dựng ngược, xin đừng chụp hình lúc này.', 'https://images.pexels.com/photos/34944222/pexels-photo-34944222.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Nhìn chằm chằm cái túi trên tay chủ', 'Nhìn chằm chằm cái túi trên tay chủ, chắc chắn trong đó có đồ ăn.', 'https://images.pexels.com/photos/37933087/pexels-photo-37933087.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Đi khám phá góc phố mới', 'Đi khám phá góc phố mới, cái gì cũng phải ghé mũi ngửi thử một cái.', 'https://images.pexels.com/photos/38221522/pexels-photo-38221522.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Đứng giữa đường tám chuyện', 'Hai đứa đứng tám chuyện giữa đường, quên mất là đang đi dạo.', 'https://images.pexels.com/photos/38306667/pexels-photo-38306667.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Chạy thi trên đường đất', 'Rủ nhau ra đường đất chạy thi, về đích không có phần thưởng vẫn vui.', 'https://images.pexels.com/photos/7256826/pexels-photo-7256826.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Buổi chiều lười nằm dài ngoài sân', 'Buổi chiều lười biếng, nằm dài ngoài sân nghe gió cho hết ngày.', 'https://images.pexels.com/photos/8093682/pexels-photo-8093682.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Lao đi bắt bóng thì khựng lại', 'Đang lao đi bắt quả bóng thì nhớ ra mình chưa biết bắt bóng.', 'https://images.pexels.com/photos/9810766/pexels-photo-9810766.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Cúi đầu nhận lỗi cho có lệ', 'Cúi đầu nhận lỗi cho có lệ, trong lòng không hối hận gì cả.', 'https://images.unsplash.com/photo-1507146426996-ef05306b995a?w=800&auto=format&fit=crop'],
  ['Nghiêng đầu suy nghĩ chuyện xin ăn', 'Nghiêng đầu suy nghĩ xem tối nay nên xin ăn thêm mấy lần.', 'https://images.unsplash.com/photo-1518020382113-a7e8fc38eac9?w=800&auto=format&fit=crop'],
  ['Cười tươi vì nghe tiếng mở túi', 'Cười tươi hết cỡ vì vừa nghe thấy tiếng mở túi thức ăn.', 'https://images.unsplash.com/photo-1518717758536-85ae29035b6d?w=800&auto=format&fit=crop'],
  ['Đớp hụt miếng bánh', 'Đớp hụt miếng bánh, giả vờ như từ đầu mình không hề định ăn.', 'https://images.unsplash.com/photo-1534361960057-19889db9621e?w=800&auto=format&fit=crop'],
  ['Thè lưỡi cười vì được đi dạo lâu', 'Thè lưỡi cười vì hôm nay được đi dạo lâu gấp đôi mọi ngày.', 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=800&auto=format&fit=crop'],
  ['Hai đứa thi làm mặt xấu', 'Hai đứa thi nhau làm mặt xấu, ai nhịn cười trước là thua.', 'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?w=800&auto=format&fit=crop'],
  ['Chạy một vòng rồi quên định làm gì', 'Chạy khắp nhà một vòng rồi quên mất lúc nãy mình định làm gì.', 'https://images.unsplash.com/photo-1552053831-71594a27632d?w=800&auto=format&fit=crop'],
  ['Nghiêng đầu lắng nghe được đúng một từ', 'Nghiêng đầu lắng nghe chủ nói, hiểu được đúng một từ là "đi chơi".', 'https://images.unsplash.com/photo-1561037404-61cd46aa615b?w=800&auto=format&fit=crop'],
  ['Mặc áo mưa vàng tự tin cả xóm nhìn', 'Mặc áo mưa vàng chóe, tự tin là cả xóm đang nhìn về phía mình.', 'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?w=800&auto=format&fit=crop'],
  ['Ngồi thẳng lưng ra dáng sếp', 'Ngồi thẳng lưng ra dáng sếp, chờ nhân viên nộp báo cáo khúc xương.', 'https://images.unsplash.com/photo-1544568100-847a948585b9?w=800&auto=format&fit=crop'],
].map(([title, description, imageUrl]) => ({ title, description, imageUrl, category: 'animals' }));

const catPins: PetPin[] = [
  ['Mặc áo len ngồi im vì lười', 'Mặc áo len ngồi im một chỗ, không phải vì ngoan mà vì lười cử động.', 'https://images.pexels.com/photos/11187356/pexels-photo-11187356.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Nằm nghiêng nhìn ra cửa sổ', 'Nằm nghiêng nhìn ra cửa sổ, suy tư về bữa tối vẫn chưa tới.', 'https://images.pexels.com/photos/11238585/pexels-photo-11238585.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Duỗi người khoe lông rồi nằm lại', 'Duỗi người khoe bộ lông sọc, xong lại nằm y như tư thế cũ.', 'https://images.pexels.com/photos/13081375/pexels-photo-13081375.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Ngồi thẳng ghi nhớ ai đi ngang', 'Ngồi thẳng nhìn quanh phòng, ghi nhớ hết ai vừa đi ngang qua.', 'https://images.pexels.com/photos/16412582/pexels-photo-16412582.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Mắt vàng mở to giữa trưa', 'Mắt vàng mở to giữa trưa, tính ngủ tiếp mà chưa dứt khoát.', 'https://images.pexels.com/photos/19511759/pexels-photo-19511759.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Ngủ trong nắng ấm ai gọi cũng kệ', 'Ngủ trong nắng ấm, ai gọi thì cứ để đó tính sau.', 'https://images.pexels.com/photos/28243688/pexels-photo-28243688.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Lăn ra đống lá mùa thu', 'Lăn ra đống lá mùa thu nghịch một lúc rồi bỏ đi chỗ khác.', 'https://images.pexels.com/photos/29584856/pexels-photo-29584856.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Chiếm nguyên ghế sofa và gối vàng', 'Chiếm nguyên cái ghế sofa với cái gối vàng, phần còn lại của nhà tùy mọi người.', 'https://images.pexels.com/photos/30239303/pexels-photo-30239303.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Canh giữ ô nắng bên cửa sổ', 'Nằm cạnh cửa sổ nắng, canh giữ ô nắng này không cho ai lại gần.', 'https://images.pexels.com/photos/33585483/pexels-photo-33585483.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Duỗi dài bên cửa sổ đúng kế hoạch', 'Duỗi dài bên cửa sổ, một buổi chiều trôi qua đúng như kế hoạch.', 'https://images.pexels.com/photos/33585484/pexels-photo-33585484.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Đón nắng trên bậu cửa sổ', 'Nằm trên bậu cửa sổ đón nắng, lịch làm việc hôm nay chỉ có mỗi việc này.', 'https://images.pexels.com/photos/33585487/pexels-photo-33585487.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Cuộn mình trong chăn xanh', 'Cuộn mình trong chăn xanh bên cửa sổ, ngoài kia lạnh thì mặc kệ.', 'https://images.pexels.com/photos/34345889/pexels-photo-34345889.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Chọn chỗ đẹp lên hình thì nằm', 'Nằm trên tấm chăn hoa văn, chọn chỗ nào lên hình đẹp thì nằm.', 'https://images.pexels.com/photos/35224529/pexels-photo-35224529.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Ngủ say trên ghế xám', 'Ngủ say trên ghế xám, cả thế giới cứ để yên ngoài cửa.', 'https://images.pexels.com/photos/37667519/pexels-photo-37667519.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Ngồi nhìn tường nghĩ chuyện lớn', 'Ngồi giữa phòng nhìn bức tường, hình như đang nghĩ chuyện gì to tát lắm.', 'https://images.pexels.com/photos/38728868/pexels-photo-38728868.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Nghịch ghế vàng rồi làm bộ ngây thơ', 'Nghịch trên ghế vàng một lúc rồi làm bộ như chưa từng.', 'https://images.pexels.com/photos/39040811/pexels-photo-39040811.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Ghé sát máy ảnh nhìn thẳng', 'Ghé sát máy ảnh nhìn thẳng, muốn biết cái này có ăn được không.', 'https://images.pexels.com/photos/680994/pexels-photo-680994.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Lông xù nằm trên chăn đầy nghi ngờ', 'Lông xù nằm trên chăn mềm, nhìn vào ống kính với ánh mắt đầy nghi ngờ.', 'https://images.pexels.com/photos/6897077/pexels-photo-6897077.jpeg?auto=compress&cs=tinysrgb&h=415&w=600'],
  ['Cười mỉm sau khi đẩy cốc rơi', 'Cười mỉm đắc ý vì vừa đẩy cái cốc rơi khỏi bàn thành công.', 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=800&auto=format&fit=crop'],
  ['Hôm nay mệt chỉ muốn nằm dài', 'Hôm nay mệt, chỉ muốn nằm dài ra một chỗ và không làm gì cả.', 'https://images.unsplash.com/photo-1516139008210-96e45dccd83b?w=800&auto=format&fit=crop'],
  ['Ai vừa động vào hộp cát', 'Ai vừa động vào hộp cát của tôi? Đứng im khai báo ngay.', 'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?w=800&auto=format&fit=crop'],
  ['Ngơ ngác nhìn ra đời', 'Ngơ ngác nhìn ra đời, chưa hiểu chuyện gì nhưng vẫn thấy lạ.', 'https://images.unsplash.com/photo-1573865526739-10659fec78a5?w=800&auto=format&fit=crop'],
  ['Vừa ngáp vừa díu mắt chúc ngủ ngon', 'Vừa ngáp vừa díu mắt, chúc cả nhà một buổi chiều ngủ ngon.', 'https://images.unsplash.com/photo-1592194996308-7b43878e84a6?w=800&auto=format&fit=crop'],
  ['Đeo kính râm ngồi tạo dáng', 'Đeo kính râm ngồi tạo dáng, sẵn sàng làm ảnh chế cho cả nhóm.', 'https://images.unsplash.com/photo-1533738363-b7f9aef128ce?w=800&auto=format&fit=crop'],
].map(([title, description, imageUrl]) => ({ title, description, imageUrl, category: 'animals' }));

async function getImageEmbedding(imageUrl: string): Promise<number[] | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error(`download ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get('Content-Type') || 'image/jpeg';

      const formData = new FormData();
      formData.append('file', new Blob([new Uint8Array(buffer)], { type: contentType }), 'image.jpg');
      const clipRes = await fetch(`${clipServiceUrl}/embed/image`, { method: 'POST', body: formData });
      if (!clipRes.ok) throw new Error(`clip ${clipRes.status}`);

      const json = await clipRes.json();
      return json.embedding;
    } catch (err: any) {
      console.warn(`  [thử ${attempt}/3] lỗi embed ${imageUrl}: ${err.message || err}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return null;
}

async function main() {
  console.log('Seed dữ liệu chó/mèo cho tìm kiếm bằng hình ảnh...');

  await prisma.user.upsert({
    where: { id: PET_USER.id },
    update: { username: PET_USER.username, email: PET_USER.email, avatarUrl: PET_USER.avatarUrl, bio: PET_USER.bio },
    create: PET_USER,
  });

  const removed = await prisma.pin.deleteMany({ where: { userId: PET_USER.id } });
  console.log(`Đã xóa ${removed.count} ghim cũ của tài khoản ${PET_USER.username}.`);

  const allPins = [...dogPins, ...catPins];
  let ok = 0;
  let noEmbedding = 0;
  for (let i = 0; i < allPins.length; i++) {
    const pin = allPins[i];
    console.log(`[${i + 1}/${allPins.length}] ${pin.title}`);

    const created = await prisma.pin.create({
      data: {
        title: pin.title,
        description: pin.description,
        imageUrl: pin.imageUrl,
        userId: PET_USER.id,
        isAiGenerated: false,
        category: pin.category,
      },
    });

    const embedding = await getImageEmbedding(pin.imageUrl);
    if (embedding) {
      await prisma.$executeRawUnsafe(
        'UPDATE "Pin" SET "embedding" = $1::vector WHERE id = $2',
        JSON.stringify(embedding),
        created.id,
      );
      ok++;
    } else {
      noEmbedding++;
      console.warn('  -> không lấy được vector, ghim này sẽ không xuất hiện trong tìm kiếm bằng hình ảnh.');
    }
  }

  console.log('========================================');
  console.log(`Hoàn tất: ${allPins.length} ghim (${dogPins.length} chó, ${catPins.length} mèo).`);
  console.log(`Có vector: ${ok} | Thiếu vector: ${noEmbedding}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error('Lỗi seed:', e);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
