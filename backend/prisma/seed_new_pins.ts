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

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const newUsers = [
  {
    id: 'sample-user-id-7',
    username: 'chloe_kpop',
    email: 'chloe@example.com',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150',
    bio: 'K-Pop fan girl. Chia sẻ những khoảnh khắc stage, outfit và album lấp lánh.',
  },
  {
    id: 'sample-user-id-8',
    username: 'oliver_sketches',
    email: 'oliver@example.com',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150',
    bio: 'Nghệ sĩ phác thảo và hội họa tự do. Thế giới của những đường nét chì và màu sắc.',
  },
];

const newPinsData = [
  // ==========================================
  // CHLOE_KPOP (sample-user-id-7) - K-Pop (25 Pins)
  // ==========================================
  {
    title: 'Biểu diễn nhảy nhóm nữ K-Pop',
    description: 'Khoảnh khắc vũ đạo đồng đều đầy năng lượng trên nền nhạc trẻ trung sôi động.',
    imageUrl: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Phòng tập nhảy K-Pop chuyên nghiệp',
    description: 'Không gian tập luyện đầy mồ hôi và đam mê của các thực tập sinh trước ngày debut.',
    imageUrl: 'https://images.unsplash.com/photo-1545128485-c400e7702796?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Ánh đèn neon lung linh thời trang sân khấu',
    description: 'Mẫu trang phục biểu diễn độc lạ tỏa sáng dưới ánh đèn neon huyền ảo màu hồng.',
    imageUrl: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Vibe đường phố Seoul buổi tối',
    description: 'Một cô gái phong cách trẻ trung năng động dạo chơi trên con phố Seoul hoa lệ.',
    imageUrl: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Chụp hình thời trang idol K-Pop',
    description: 'Phong cách makeup và tạo dáng xuất sắc chuẩn tạp chí của idol trẻ tuổi.',
    imageUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Streetwear cá tính đậm chất K-fashion',
    description: 'Outfit năng động phù hợp cho những ngày đi concert và dạo phố cổ truyền Hàn Quốc.',
    imageUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Styling tóc và trang điểm K-Pop nổi bật',
    description: 'Chi tiết lối makeup lung linh thời thượng luôn dẫn đầu xu hướng làm đẹp châu Á.',
    imageUrl: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Bầu không khí concert rực rỡ',
    description: 'Khán đài rực sáng với hàng ngàn lightstick lấp lánh hòa chung giọng ca ngọt ngào.',
    imageUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Thiết kế sân khấu hoành tráng',
    description: 'Không gian trình diễn rực lửa đầy sắc màu của lễ trao giải âm nhạc cuối năm.',
    imageUrl: 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Chân dung phong cách retro idol',
    description: 'Tone màu ấm áp cổ điển lưu lại vẻ đẹp rực rỡ của tuổi trẻ đam mê nghệ thuật.',
    imageUrl: 'https://images.unsplash.com/photo-1554151228-14d9def656e4?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Aesthetic street look thu hút',
    description: 'Sự kết hợp hoàn hảo giữa áo thun oversize và phụ kiện cá tính mang hơi hướng Hip-hop.',
    imageUrl: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Nụ cười tỏa nắng chuẩn visual',
    description: 'Thần thái vui tươi tràn đầy năng lượng tích cực lan tỏa đến mọi fan hâm mộ.',
    imageUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'K-fashion boy style thanh lịch',
    description: 'Phong cách nam thần tối giản nhưng cực kỳ lôi cuốn với áo khoác măng tô dài.',
    imageUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Trang phục biểu diễn năng động nam',
    description: 'Phong cách streetwear thể thao mạnh mẽ kết hợp giày sneaker bản giới hạn.',
    imageUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Vũ đạo cuốn hút dưới ánh đèn',
    description: 'Khoảnh khắc trình diễn solo cực cháy đầy quyến rũ trên sân khấu K-Pop.',
    imageUrl: 'https://images.unsplash.com/photo-1519741497674-611481863552?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Gương mặt góc cạnh thu hút',
    description: 'Vẻ đẹp phi giới tính đầy ấn tượng và thu hút của mẫu ảnh trẻ triển vọng.',
    imageUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Dạo bước ngắm phố phường Hàn Quốc',
    description: 'Phong cách thời trang thu đông ấm áp dạo bước ngắm lá phong rơi.',
    imageUrl: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Model thời trang trẻ trung Seoul',
    description: 'Biểu cảm thần thái chuyên nghiệp trong buổi chụp lookbook thương hiệu mới.',
    imageUrl: 'https://images.unsplash.com/photo-1488161628813-04466f872be2?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Góc nghiêng thần thánh chuẩn nam thần',
    description: 'Những nét thanh tú lôi cuốn trên khuôn mặt nam nghệ sĩ dưới nắng nhẹ.',
    imageUrl: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Tạo dáng cool ngầu đường phố',
    description: 'Phong cách vintage pha chút bụi bặm của giới trẻ yêu thích Hip-hop Hàn Quốc.',
    imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Chụp hình studio nghệ thuật ánh sáng',
    description: 'Sự kết hợp giữa bóng tối và ánh sáng dịu tạo nên chiều sâu bức ảnh nghệ thuật.',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Sân khấu biểu diễn huyền ảo',
    description: 'Làn khói mờ ảo kết hợp laser chiếu rọi bóng hình idol cất tiếng hát ngọt ngào.',
    imageUrl: 'https://images.unsplash.com/photo-1519345182560-3f2917c472ef?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Outfit dạo phố phong cách Hàn',
    description: 'Sự trẻ trung năng động tôn lên nét đẹp khỏe khoắn của thanh xuân rực rỡ.',
    imageUrl: 'https://images.unsplash.com/photo-1503023345310-bd7c1de61c7d?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Visual idol cuốn hút nhẹ nhàng',
    description: 'Gương mặt trong trẻo toát lên thần thái thuần khiết chuẩn gu Hàn Quốc.',
    imageUrl: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },
  {
    title: 'Model nam tính cá tính nổi bật',
    description: 'Sự mạnh mẽ và lạnh lùng toát lên sức hút vô cùng đặc biệt đầy bí ẩn.',
    imageUrl: 'https://images.unsplash.com/photo-1518806118471-f28b20a1d79d?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-7',
    category: 'kpop'
  },

  // ==========================================
  // OLIVER_SKETCHES (sample-user-id-8) - Drawing & Artwork (25 Pins)
  // ==========================================
  {
    title: 'Tranh vẽ sơn dầu trừu tượng rực rỡ',
    description: 'Những nhát cọ sơn dầu đầy ngẫu hứng tạo nên bức tranh đầy chiều sâu và cảm xúc.',
    imageUrl: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Ký họa chân dung bằng bút chì',
    description: 'Sự chi tiết và tỉ mỉ trong từng đường nét vẽ chì phác thảo gương mặt nghệ thuật.',
    imageUrl: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Khay pha màu acrylic đầy màu sắc',
    description: 'Vẻ đẹp lộn xộn của khay màu trong studio vẽ tranh tràn đầy cảm hứng sáng tạo.',
    imageUrl: 'https://images.unsplash.com/photo-1580136579312-94651dfd596d?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Phác thảo tác phẩm trên vải canvas',
    description: 'Các nét vẽ chì đầu tiên định hình bố cục cho một kiệt tác sơn dầu tương lai.',
    imageUrl: 'https://images.unsplash.com/photo-1579783928621-7a13d66a62d1?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Ký họa than chì Charcoal đen trắng',
    description: 'Hiệu ứng ánh sáng và bóng đổ cực mạnh thể hiện bằng chất liệu than đen vẽ tay.',
    imageUrl: 'https://images.unsplash.com/photo-1605721911519-3dfeb3be25e7?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Quyển sổ sketchbook mở trang vẽ',
    description: 'Thói quen ký họa hàng ngày lưu giữ những ý tưởng sáng tạo bất chợt nảy sinh.',
    imageUrl: 'https://images.unsplash.com/photo-1544816155-12df9643f363?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Vẽ anime trên bảng vẽ Wacom',
    description: 'Quá trình đi nét (line art) nhân vật anime Nhật Bản trên phần mềm chuyên nghiệp.',
    imageUrl: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Họa sĩ sáng tác tranh khổ lớn',
    description: 'Không gian làm việc tự do của người nghệ sĩ chìm đắm trong hội họa trên nền phòng thu.',
    imageUrl: 'https://images.unsplash.com/photo-1536924940846-227afb31e2a5?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Nghệ thuật tranh màu nước loang mịn',
    description: 'Kỹ thuật loang màu nước nhẹ nhàng tạo nên cảnh sắc thiên nhiên thơ mộng bình yên.',
    imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Mảng màu acrylic nổi khối 3D',
    description: 'Cách đắp màu dày độc đáo tạo hiệu ứng nổi khối texture bắt mắt cho tác phẩm hiện đại.',
    imageUrl: 'https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Góc làm việc đầy cọ vẽ và bút màu',
    description: 'Nơi khởi nguồn của những ý tưởng độc đáo với đầy đủ họa cụ vẽ tay truyền thống.',
    imageUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Màu vẽ nghệ thuật pha trộn ngẫu hứng',
    description: 'Vẻ đẹp rực rỡ đầy tính trừu tượng từ sự pha lẫn các gam màu nóng lạnh tương phản.',
    imageUrl: 'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Bộ cọ vẽ màu nước xếp ngay ngắn',
    description: 'Dụng cụ không thể thiếu của họa sĩ chuyên nghiệp trong quá trình sáng tạo nghệ thuật.',
    imageUrl: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Triển lãm các bản vẽ chì phác thảo',
    description: 'Góc nhỏ trưng bày các tác phẩm vẽ tay độc bản của sinh viên mỹ thuật.',
    imageUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Bàn vẽ kỹ thuật chứa dụng cụ phác họa',
    description: 'Bố cục ngăn nắp của bút chì, thước kẻ và bản vẽ tay công trình kiến trúc.',
    imageUrl: 'https://images.unsplash.com/photo-1513542789411-b6a5d4f31634?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Tranh tĩnh vật bình hoa cổ điển',
    description: 'Bức họa tả thực tĩnh vật mang phong cách quý tộc châu Âu thời Phục hưng.',
    imageUrl: 'https://images.unsplash.com/photo-1482440308425-276ad0f28b19?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Bản vẽ phác họa quy hoạch phong cảnh',
    description: 'Nét chì mềm mại thể hiện ý tưởng thiết kế sân vườn và tiểu cảnh kiến trúc độc đáo.',
    imageUrl: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Concept art nhân vật kỹ thuật số',
    description: 'Thiết kế tạo hình nhân vật game 3D bằng bảng vẽ màn hình chuyên dụng.',
    imageUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Tranh phong cảnh quê hương mộc mạc',
    description: 'Bức tranh vẽ tay ghi lại vẻ đẹp thanh bình của làng quê Việt Nam yên ả.',
    imageUrl: 'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Pha trộn sơn dầu mịn màng',
    description: 'Những nhát bay pha màu tạo nên dải chuyển sắc vô cùng hài hòa bắt mắt.',
    imageUrl: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Digital drawing phác thảo nét mượt',
    description: 'Quá trình đi nét gọn gàng cho hình minh họa minh họa truyện tranh số.',
    imageUrl: 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Hội họa minh họa chân dung cách điệu',
    description: 'Bức vẽ sáng tạo thể hiện cá tính nhân vật qua đường nét và mảng màu hiện đại.',
    imageUrl: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Bộ chì vẽ chuyên nghiệp đủ độ đậm nhạt',
    description: 'Từ chì 2H đến 8B xếp ngăn nắp sẵn sàng cho các bài vẽ dựng hình khối cơ bản.',
    imageUrl: 'https://images.unsplash.com/photo-1518156677180-95a2893f3e9f?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Ký họa tượng thạch cao cổ điển',
    description: 'Bài thực hành vẽ khối đầu tượng Hy Lạp giúp luyện tập sắc độ sáng tối bóng đổ.',
    imageUrl: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },
  {
    title: 'Workspace ngập tràn bản sketch nhỏ',
    description: 'Không gian ngập tràn sự phóng khoáng và nguồn năng lượng dồi dào của họa sĩ vẽ tay.',
    imageUrl: 'https://images.unsplash.com/photo-1513542789411-b6a5d4f31634?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-8',
    category: 'drawing'
  },

  // ==========================================
  // LUCAS_ACOUSTICS (sample-user-id-5) - Anime (25 Pins)
  // ==========================================
  {
    title: 'Phố đêm Tokyo lung linh ánh điện',
    description: 'Một góc phố shibuya ngập tràn bảng hiệu neon rực rỡ đậm phong cách Anime cyberpunk.',
    imageUrl: 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Bầu trời hoàng hôn Tokyo từ trên cao',
    description: 'Khung cảnh thành phố nhuộm sắc cam hồng ấm áp lãng mạn như phim của Makoto Shinkai.',
    imageUrl: 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Quán ramen nhỏ ấm cúng trong ngõ hẻm',
    description: 'Góc ăn uống vintage nhỏ xinh ẩn mình trong lòng Tokyo yên bình tĩnh lặng.',
    imageUrl: 'https://images.unsplash.com/photo-1504618223053-559bdef9dd5a?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Màn hình máy tính đầy mã nguồn xanh lá',
    description: 'Vibe hacker bí ẩn phong cách anime viễn tưởng với những dòng lệnh ma trận rực sáng.',
    imageUrl: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Góc chơi game ngập tràn đèn LED RGB',
    description: 'Bố cục phòng máy cực chất dành cho các tín đồ yêu thích văn hóa game Nhật Bản.',
    imageUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Nghệ thuật ánh sáng Neon Synthwave',
    description: 'Thiết kế đồ họa mang xu hướng retro tương lai vô cùng sống động và bắt mắt.',
    imageUrl: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Bàn phím cơ retro và dây cáp xoắn',
    description: 'Góc setup PC phong cách cổ điển lôi cuốn dành cho các tín đồ mê phần cứng máy tính.',
    imageUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Hộp băng game bốn nút kỷ niệm xưa',
    description: 'Kỷ vật tuổi thơ gợi nhớ lại thời đại game 8-bit hào hùng cùng bạn bè.',
    imageUrl: 'https://images.unsplash.com/photo-1566241440091-ec10de8db2e1?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Tay cầm chơi game rực rỡ sắc màu',
    description: 'Hiệu ứng ánh sáng LED phản chiếu trên tay cầm điều khiển đậm chất gaming hiện đại.',
    imageUrl: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Bo mạch điện tử chi tiết phát sáng',
    description: 'Vẻ đẹp cơ khí vi mạch điện tử mang hơi hướng khoa học viễn tưởng khoa học.',
    imageUrl: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Màn hình code lập trình viên ban đêm',
    description: 'Sự tập trung cao độ bên những dòng code rực sáng trong phòng tối tĩnh lặng.',
    imageUrl: 'https://images.unsplash.com/photo-1542831371-29b0f74f9713?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Hẻm nhỏ Tokyo ngập tràn bảng hiệu',
    description: 'Lối đi nhỏ thơ mộng ngập tràn ánh đèn neon đỏ mang đậm nét văn hóa đô thị Nhật Bản.',
    imageUrl: 'https://images.unsplash.com/photo-1601987177651-8edfe6c20009?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Bức vẽ tranh đường phố Anime Graffiti',
    description: 'Bức tường vẽ nhân vật manga đầy sáng tạo thể hiện phong cách năng động của giới trẻ.',
    imageUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Góc làm việc đầy cảm hứng công nghệ',
    description: 'Sự tối giản kết hợp ánh sáng dịu nhẹ mang lại cảm giác thoải mái tập trung làm việc.',
    imageUrl: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Lập trình hệ thống mã nguồn phức tạp',
    description: 'Vẻ đẹp logic của các dòng code cấu trúc dữ liệu hiển thị trên màn hình tối.',
    imageUrl: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Bề mặt kim loại xước bóng bẩy',
    description: 'Tone màu xám bạc đậm chất robot tương lai và các chi tiết cơ khí cơ bản.',
    imageUrl: 'https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Kỹ sư kiểm tra bo mạch công nghiệp',
    description: 'Sự kết hợp giữa công nghệ hiện đại và bàn tay khéo léo của con người.',
    imageUrl: 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Cánh tay robot cơ khí tự động hóa',
    description: 'Biểu tượng của kỷ nguyên AI và tự động hóa trong các phòng nghiên cứu khoa học.',
    imageUrl: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Bản mạch phát sáng trong bóng tối',
    description: 'Đường truyền dữ liệu lấp lánh như mạng lưới tế bào thần kinh kỹ thuật số.',
    imageUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Cửa hàng đĩa nhạc đĩa than lung linh',
    description: 'Bầu không khí cổ điển ngập tràn đĩa nhạc retro lấp lánh dưới đèn neon ấm áp.',
    imageUrl: 'https://images.unsplash.com/photo-1506157786151-b8491531f063?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Ánh đèn biểu diễn sân khấu hoành tráng',
    description: 'Cột sáng laser chiếu rọi rực rỡ tôn vinh khoảnh khắc tỏa sáng của người nghệ sĩ.',
    imageUrl: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Không gian tiệc tùng ngập tràn nhạc EDM',
    description: 'Những dải màu neon huyền ảo đan xen cùng tiếng bass dồn dập rực lửa.',
    imageUrl: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Đám đông cuồng nhiệt dưới khán đài',
    description: 'Hàng ngàn cánh tay giơ cao hòa chung niềm phấn khích tột độ cùng giai điệu.',
    imageUrl: 'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Biểu diễn nhạc rock guitar điện sôi động',
    description: 'Hình bóng guitarist bùng cháy hết mình dưới dải laser neon xanh ngọc cuốn hút.',
    imageUrl: 'https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },
  {
    title: 'Con phố ẩm thực Tokyo phong cách Manga',
    description: 'Ánh đèn lấp lánh phản chiếu trên nền đường ướt sau cơn mưa rào buổi tối.',
    imageUrl: 'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
    category: 'anime'
  },

  // ==========================================
  // MEME_LORD (sample-user-id-6) - Meme (25 Pins)
  // ==========================================
  {
    title: 'Chú mèo mặt cười Smug cực kỳ đắc ý',
    description: 'Gương mặt hài hước của chú mèo khi nhìn thẳng vào camera như đang trêu chọc bạn.',
    imageUrl: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Mèo ngơ ngác nhìn đời tò mò',
    description: 'Biểu cảm đáng yêu khó đỡ khi chú mèo phát hiện ra điều gì đó vô cùng lạ lẫm.',
    imageUrl: 'https://images.unsplash.com/photo-1573865526739-10659fec78a5?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Boss mèo đeo kính râm cực ngầu',
    description: 'Phong cách thời trang cool ngầu của chú mèo cưng sẵn sàng làm meme chế ảnh.',
    imageUrl: 'https://images.unsplash.com/photo-1533738363-b7f9aef128ce?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Cún cưng thè lưỡi cười hớn hở',
    description: 'Vẻ mặt vui sướng ngốc nghếch của chú chó khi được chủ nhân dắt đi dạo chơi.',
    imageUrl: 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Corgi mặc áo mưa màu vàng chói lóa',
    description: 'Dáng đứng đáng yêu lùn tịt trong bộ áo mưa sẵn sàng chinh phục mọi vũng nước.',
    imageUrl: 'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Chú cún đớp hụt đồ ăn điệu nghệ',
    description: 'Khoảnh khắc hài hước bắt trọn gương mặt hoảng hốt khi đớp hụt miếng bánh ngon.',
    imageUrl: 'https://images.unsplash.com/photo-1534361960057-19889db9621e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Pug mặt xệ nghiêng đầu khó hiểu',
    description: 'Biểu cảm ngu ngơ ngộ nghĩnh của chú chó Pug luôn là nguồn cảm hứng chế meme vô tận.',
    imageUrl: 'https://images.unsplash.com/photo-1518020382113-a7e8fc38eac9?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Sóc nhỏ ôm hạt dẻ cực kỳ phòng thủ',
    description: 'Gương mặt căng thẳng bảo vệ kho báu hạt dẻ của chú sóc nhỏ tinh nghịch.',
    imageUrl: 'https://images.unsplash.com/photo-1504208434309-cb69f4fe52b0?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Hai chú cún trêu đùa làm mặt xấu',
    description: 'Khoảnh khắc hai người bạn bốn chân đang đùa nghịch tạo nên bức ảnh cực kỳ hài hước.',
    imageUrl: 'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Boss mèo ngồi bệt như người lớn',
    description: 'Dáng ngồi suy tư đầy triết lý nhân sinh của chú mèo béo ú đáng yêu.',
    imageUrl: 'https://images.unsplash.com/photo-1455218873509-8097305ee378?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Mèo mập ngủ say sưa quên trời đất',
    description: 'Dáng nằm phơi bụng ngủ ngon lành không màng thế sự của chú mèo béo.',
    imageUrl: 'https://images.unsplash.com/photo-1571752726703-5e7d1f6a986d?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Chuột Hamster tò mò ghé sát camera',
    description: 'Chiếc mũi hồng và đôi mắt tròn xoe ngơ ngác khi nhìn vào ống kính máy ảnh.',
    imageUrl: 'https://images.unsplash.com/photo-1596492784531-6e6eb5ea9993?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Golden Retriever chạy nhảy ngáo ngơ',
    description: 'Bức ảnh bắt nét chuyển động hài hước của chú chó Golden khi phấn khích tột độ.',
    imageUrl: 'https://images.unsplash.com/photo-1530281700549-e82e7bf110d6?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Cún con cúi đầu nhận lỗi đáng yêu',
    description: 'Ánh mắt hối lỗi cún con sau khi lỡ cắn nát đôi dép của chủ nhân.',
    imageUrl: 'https://images.unsplash.com/photo-1507146426996-ef05306b995a?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Cún cưng cười nhăn nhở thân thiện',
    description: 'Gương mặt tươi rói khoe răng đầy ngộ nghĩnh của chú chó Husky ngáo.',
    imageUrl: 'https://images.unsplash.com/photo-1518717758536-85ae29035b6d?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Cún con nghiêng đầu lắng nghe',
    description: 'Gương mặt ngây thơ và đôi tai to vểnh lên cực kỳ đáng yêu dễ thương.',
    imageUrl: 'https://images.unsplash.com/photo-1561037404-61cd46aa615b?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Koala ôm cây ngủ lười biếng',
    description: 'Dáng vẻ buồn ngủ quên lối về của chú gấu túi Koala ôm chặt thân cây.',
    imageUrl: 'https://images.unsplash.com/photo-1503256207526-0d5d80fa2f47?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Mèo ngáp miệng rộng hoác hài hước',
    description: 'Bắt trọn khoảnh khắc ngáp cực kỳ sảng khoái của boss mèo đáng yêu.',
    imageUrl: 'https://images.unsplash.com/photo-1472491235688-bdc81a63246e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Mèo tò mò chơi đùa cùng bươm bướm',
    description: 'Vẻ mặt tập trung cao độ đầy ngộ nghĩnh khi rình rập chú bướm nhỏ xinh.',
    imageUrl: 'https://images.unsplash.com/photo-1526336024174-e58f5cdd8e13?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Chú heo con mũi hồng đáng yêu',
    description: 'Góc chụp siêu cận chiếc mũi ướt át vô cùng ngộ nghĩnh của chú heo con.',
    imageUrl: 'https://images.unsplash.com/photo-1516467508483-a7212febe31a?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Alpaca với kiểu tóc retro cực chất',
    description: 'Mái đầu bồng bềnh lãng tử của chú lạc đà Alpaca làm chao đảo cộng đồng mạng.',
    imageUrl: 'https://images.unsplash.com/photo-1589182373726-e4f658ab50f0?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Pug con hoang mang tột độ',
    description: 'Đôi mắt lồi tròn xoe ngấn lệ nhìn vô cùng tội nghiệp và hài hước.',
    imageUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Mèo nhìn chằm chằm đầy phán xét',
    description: 'Gương mặt lạnh lùng đầy quyền lực của boss mèo nhìn sen đầy nghiêm nghị.',
    imageUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Alpaca cười nhe răng thân thiện',
    description: 'Nụ cười rạng rỡ khoe bộ răng độc lạ của chú lạc đà trên đồng cỏ xanh.',
    imageUrl: 'https://images.unsplash.com/photo-1554151228-14d9def656e4?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  },
  {
    title: 'Hội bạn thân nhảy cao vui sướng',
    description: 'Tư thế nhảy ngớ ngẩn đầy tự do của nhóm bạn trong kỳ nghỉ hè rực rỡ.',
    imageUrl: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
    category: 'meme'
  }
];

async function main() {
  console.log('Bắt đầu chạy Seed dữ liệu PostgreSQL cho Supabase (New Pins)...');

  // 1. Tạo các người dùng mẫu mới nếu chưa tồn tại
  console.log('Tạo/Cập nhật các người dùng mẫu mới...');
  for (const userData of newUsers) {
    await prisma.user.upsert({
      where: { id: userData.id },
      update: {
        username: userData.username,
        email: userData.email,
        avatarUrl: userData.avatarUrl,
        bio: userData.bio,
      },
      create: userData,
    });
  }

  // 2. Dọn dẹp ghim cũ của 2 user mới trước khi seed
  console.log('Dọn dẹp các ghim cũ của các tài khoản mới...');
  const userIds = newUsers.map((u) => u.id);
  await prisma.pin.deleteMany({
    where: {
      userId: { in: userIds },
    },
  });

  // 3. Tiến hành chèn 100 ghim ảnh mới (K-Pop, Drawing, Anime, Memes)
  console.log(`Tiến hành chèn thêm ${newPinsData.length} ghim ảnh mới (K-Pop, Drawing, Anime, Memes)...`);
  let newCount = 0;
  for (const pin of newPinsData) {
    await prisma.pin.create({
      data: {
        title: pin.title,
        description: pin.description,
        imageUrl: pin.imageUrl,
        userId: pin.userId,
        isAiGenerated: false,
        category: pin.category,
      },
    });
    newCount++;
  }
  console.log(`Đã chèn thành công thêm ${newCount} ghim ảnh mới vào cơ sở dữ liệu!`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error('Lỗi xảy ra trong quá trình seed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
