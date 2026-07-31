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

const seedUsers = [
  {
    id: 'mock-user-id-12345',
    username: 'nguyen_van_a',
    email: 'developer@example.com',
    avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150',
    bio: 'Tài khoản lập trình viên Pinterest AI',
  },
  {
    id: 'sample-user-id-1',
    username: 'alex_explorer',
    email: 'alex@example.com',
    avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150',
    bio: 'Khám phá thế giới qua lăng kính nhiếp ảnh. Đam mê thiên nhiên và du lịch bụi.',
  },
  {
    id: 'sample-user-id-2',
    username: 'jane_chef',
    email: 'jane@example.com',
    avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150',
    bio: 'Blogger ẩm thực và nghệ sĩ làm bánh. Chia sẻ công thức nấu ăn ngon mỗi ngày.',
  },
  {
    id: 'sample-user-id-3',
    username: 'charlie_creative',
    email: 'charlie@example.com',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150',
    bio: 'Nhà thiết kế 3D, lập trình viên yêu thích nghệ thuật trừu tượng và khoa học viễn tưởng.',
  },
  {
    id: 'sample-user-id-4',
    username: 'emily_fashion',
    email: 'emily@example.com',
    avatarUrl: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=150',
    bio: 'Nhà tạo mẫu, biên tập viên thời trang và người đam mê xe cổ vintage cổ điển.',
  },
  {
    id: 'sample-user-id-5',
    username: 'lucas_acoustics',
    email: 'lucas@example.com',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150',
    bio: 'Đam mê âm thanh hi-fi, thiết kế phòng nhạc và nhạc cụ acoustic cổ điển.',
  },
  {
    id: 'sample-user-id-6',
    username: 'meme_lord',
    email: 'memelord@example.com',
    avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150',
    bio: 'Vua ảnh chế internet. Ở đây chỉ có tiếng cười và sự hài hước.',
  },
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

// 100 Pins grouped logically by topics and assigned to specific users
const pinsData = [
  // ==========================================
  // ALEX_EXPLORER (sample-user-id-1) - Nature & Travel (25 Pins)
  // ==========================================
  {
    title: 'Hồ nước trên núi xanh ngắt',
    description: 'Một hồ nước tuyệt đẹp trên đỉnh núi Alps với làn nước trong vắt phản chiếu bầu trời.',
    imageUrl: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Con đường xuyên rừng sương mù',
    description: 'Lối đi đầy cây xanh ẩn hiện trong làn sương mù ban mai tĩnh lặng.',
    imageUrl: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Bãi biển nhiệt đới hoàng hôn',
    description: 'Bờ cát trắng mịn trải dài bên rặng dừa thơ mộng lúc hoàng hôn buông xuống.',
    imageUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Rừng cây lá vàng mùa thu',
    description: 'Màu sắc rực rỡ của mùa thu nhuộm vàng cả cánh rừng hoang dã.',
    imageUrl: 'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Sóng biển vỗ rì rào',
    description: 'Cận cảnh những con sóng xanh ngọc bích xô vào ghềnh đá.',
    imageUrl: 'https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Đồi cát sa mạc lộng gió',
    description: 'Những đường cong hoàn mỹ của cát sa mạc dưới ánh nắng vàng ruộm.',
    imageUrl: 'https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Thác nước hùng vĩ trong rừng sâu',
    description: 'Dòng nước trắng xóa đổ xuống từ vách đá dựng đứng giữa rừng nhiệt đới.',
    imageUrl: 'https://images.unsplash.com/photo-1482862549707-f63cb32c5fd9?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Cực quang huyền ảo phương Bắc',
    description: 'Ánh sáng xanh cực quang nhảy múa trên bầu trời đêm đầy sao tại Na Uy.',
    imageUrl: 'https://images.unsplash.com/photo-1483347756197-71ef80e95f73?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Đỉnh núi tuyết phủ trắng xóa',
    description: 'Đỉnh núi Everest kiêu hãnh chìm trong mây mù và tuyết lạnh giá.',
    imageUrl: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Cánh đồng hoa oải hương',
    description: 'Sắc tím thơ mộng trải dài vô tận tại vùng Provence nước Pháp thanh bình.',
    imageUrl: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Cabin gỗ ven hồ yên bình',
    description: 'Một ngôi nhà gỗ nhỏ ấm cúng nằm biệt lập sát bờ hồ tĩnh lặng lúc sớm mai.',
    imageUrl: 'https://images.unsplash.com/photo-1510312305653-8ed496efae75?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Lửa trại bập bùng dưới trời sao',
    description: 'Khoảnh khắc cắm trại ấm áp bên đống lửa bập bùng giữa thiên nhiên hoang dã.',
    imageUrl: 'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Nhà leo núi ngắm bình minh',
    description: 'Một phượt thủ đứng trên đỉnh núi cao ngắm ánh bình minh đỏ rực đường chân trời.',
    imageUrl: 'https://images.unsplash.com/photo-1486916856992-e4db22c8df33?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Khinh khí cầu tại Cappadocia',
    description: 'Hàng trăm khinh khí cầu rực rỡ bay lượn trên thung lũng đá Thổ Nhĩ Kỳ.',
    imageUrl: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Chèo thuyền Kayak hồ nước xanh',
    description: 'Trải nghiệm bình yên trôi trên mặt nước trong vắt nhìn thấy cả đáy hồ.',
    imageUrl: 'https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Ngôi làng cổ kính châu Âu',
    description: 'Những lối đi lát đá quanh co dẫn qua các ngôi nhà đầy hoa rực rỡ.',
    imageUrl: 'https://images.unsplash.com/photo-1533105079780-92b9be482077?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Con đường sa mạc chạy dài',
    description: 'Đường lộ thẳng tắp cắt ngang sa mạc tiến về phía những ngọn núi hùng vĩ.',
    imageUrl: 'https://images.unsplash.com/photo-1473448912268-2022ce9509d8?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Bãi biển vách đá từ trên cao',
    description: 'Góc nhìn flycam độc đáo xuống dòng nước xanh ngọc vỗ nhẹ bờ cát trắng.',
    imageUrl: 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Lều cắm trại trong rừng thông',
    description: 'Trải nghiệm hòa mình cùng thiên nhiên mát mẻ dưới bóng râm của rừng thông cổ thụ.',
    imageUrl: 'https://images.unsplash.com/photo-1481349518771-20055b2a7b24?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Cầu gỗ uốn lượn ven sông',
    description: 'Lối đi bộ bằng gỗ tuyệt đẹp chạy dọc theo bờ sông đầy lau sậy thơ mộng.',
    imageUrl: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Thung lũng ruộng bậc thang xanh mướt',
    description: 'Cảnh sắc ruộng bậc thang Tây Bắc Việt Nam mùa lúa xanh bát ngát.',
    imageUrl: 'https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Ngọn hải đăng bên bờ biển đá',
    description: 'Ngọn hải đăng cổ kính sừng sững canh giữ biển cả trước những cơn sóng dữ.',
    imageUrl: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Bình minh trên biển sương mù',
    description: 'Mặt trời đỏ rực nhô lên xua tan lớp sương sớm mờ ảo trên mặt biển.',
    imageUrl: 'https://images.unsplash.com/photo-1465146344425-f00d5f5c8f07?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Đường đèo uốn lượn mạo hiểm',
    description: 'Góc nhìn ngoạn mục qua những khúc cua tay áo của đường đèo vùng cao.',
    imageUrl: 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },
  {
    title: 'Rừng tre xanh mướt tĩnh lặng',
    description: 'Lối đi thanh tịnh xuyên qua rừng tre xanh ngắt râm mát tại Arashiyama.',
    imageUrl: 'https://images.unsplash.com/photo-1454496522488-7a8e488e8606?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-1',
  },

  // ==========================================
  // JANE_CHEF (sample-user-id-2) - Food & Animals (25 Pins)
  // ==========================================
  {
    title: 'Tách Cà Phê Latte Art',
    description: 'Tách cà phê nóng hổi với lớp bọt vẽ hình lá dương xỉ vô cùng khéo léo.',
    imageUrl: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Bánh pancake dâu tây ngọt ngào',
    description: 'Chồng bánh kếp mềm mại rưới mật ong và trang trí bằng những lát dâu tây tươi mọng.',
    imageUrl: 'https://images.unsplash.com/photo-1528207776546-365bb710ee93?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Burger bò phô mai chảy đẫm sốt',
    description: 'Burger bò nướng lò thơm phức kẹp phô mai cheddar tan chảy cùng rau xà lách giòn ngon.',
    imageUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Khay sushi tổng hợp tươi ngon',
    description: 'Thưởng thức ẩm thực Nhật Bản với các loại sushi cá hồi, cá ngừ và trứng cá trích.',
    imageUrl: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Pizza Neapolitan đế mỏng kiểu Ý',
    description: 'Pizza nướng củi truyền thống thơm lừng hương lá quế tây và phô mai mozzarella.',
    imageUrl: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Bánh mì bơ lát healthy',
    description: 'Bữa sáng lành mạnh với lát bánh mì đen phết bơ nghiền và trứng chần béo ngậy.',
    imageUrl: 'https://images.unsplash.com/photo-1541532713592-79a0317b6b77?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Tháp bánh Macaron đầy màu sắc',
    description: 'Những chiếc bánh Macaron Pháp ngọt ngào xếp chồng nghệ thuật bắt mắt.',
    imageUrl: 'https://images.unsplash.com/photo-1569864358642-9d1684040f43?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Quả dâu tây tươi mọng nước',
    description: 'Những trái dâu tây đỏ tươi vừa hái từ trang trại ngọt lành.',
    imageUrl: 'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Tô mì Ramen nóng hổi chuẩn vị',
    description: 'Mì ramen nước dùng xương hầm đậm đà kèm thịt xá xíu, trứng lòng đào và rong biển.',
    imageUrl: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Bánh kem sô cô la đậm vị',
    description: 'Lát bánh kem sô cô la béo mịn, ngọt ngào làm tan chảy mọi tín đồ ngọt.',
    imageUrl: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Chú mèo con lông cam tinh nghịch',
    description: 'Chú mèo con mắt xoe tròn ngơ ngác đùa nghịch bên sợi len nhỏ.',
    imageUrl: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Cún con Golden Retriever đáng yêu',
    description: 'Khuôn mặt hớn hở tinh nghịch của chú cún con Golden tinh khôn.',
    imageUrl: 'https://images.unsplash.com/photo-1552053831-71594a27632d?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Sư tử đực oai nghiêm rừng sâu',
    description: 'Chúa tể sơn lâm đầy uy lực dưới ánh nắng xuyên qua tán lá rừng rậm.',
    imageUrl: 'https://images.unsplash.com/photo-1546182990-dffeafbe841d?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Chú cáo đỏ tò mò',
    description: 'Chú cáo đỏ nổi bật giữa nền tuyết trắng xóa đang đưa mắt tìm mồi.',
    imageUrl: 'https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Cú mèo bay đêm dũng mãnh',
    description: 'Đôi cánh sải rộng điệu nghệ của loài chim săn mồi ban đêm bí ẩn.',
    imageUrl: 'https://images.unsplash.com/photo-1509248961158-e54f6934749c?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Chú nai vàng ngơ ngác trong sương',
    description: 'Bức ảnh chụp chú nai xinh xắn dừng chân giữa rừng thông sớm mai mờ sương.',
    imageUrl: 'https://images.unsplash.com/photo-1484406566174-9da000fda645?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Rùa biển xanh bơi lội tự do',
    description: 'Chú rùa biển khổng lồ đang nhẹ nhàng rẽ nước đại dương bao la.',
    imageUrl: 'https://images.unsplash.com/photo-1559583985-c80d8ad9b29f?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Gấu trúc Panda nhai lá trúc',
    description: 'Hình ảnh đáng yêu của chú gấu trúc tròn trịa nhẩn nha nhai ngọn trúc non.',
    imageUrl: 'https://images.unsplash.com/photo-1508817628294-5a453fa0b8fb?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Sóc nhỏ nhặt hạt dẻ',
    description: 'Hình ảnh bắt trọn khoảnh khắc đáng yêu của chú sóc xám đang ôm hạt dẻ rừng.',
    imageUrl: 'https://images.unsplash.com/photo-1504208434309-cb69f4fe52b0?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Chim công xòe bộ lông rực rỡ',
    description: 'Bộ lông đuôi lộng lẫy đầy sắc màu rực rỡ của chú chim công đực quý phái.',
    imageUrl: 'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Bánh nướng Croissant giòn rụm',
    description: 'Những chiếc bánh sừng bò vàng ươm thơm phức bơ sữa cho bữa sáng.',
    imageUrl: 'https://images.unsplash.com/photo-1509722747041-616f39b57569?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Salad rau củ tươi mát dọn kèm ức gà',
    description: 'Bữa ăn thuần eat clean với xà lách, cà chua bi, bơ sáp và thịt gà áp chảo.',
    imageUrl: 'https://images.unsplash.com/photo-1606787366850-de6330128bfc?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Mâm dimsum nghi ngút khói',
    description: 'Các xửng há cảo, xíu mại thơm ngon, ấm nóng trong nhà hàng Trung Hoa.',
    imageUrl: 'https://images.unsplash.com/photo-1563245372-f21724e3856d?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Ly sinh tố dâu rừng béo ngậy',
    description: 'Ly smoothie dâu rừng và việt quất mát lạnh xay mịn đầy dinh dưỡng.',
    imageUrl: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },
  {
    title: 'Bánh tart trứng phô mai vàng ươm',
    description: 'Lớp nhân trứng sữa mịn màng, béo ngậy nướng cháy cạnh thơm lừng.',
    imageUrl: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-2',
  },

  // ==========================================
  // CHARLIE_CREATIVE (sample-user-id-3) - Art, Abstract & Technology (25 Pins)
  // ==========================================
  {
    title: 'Sơn loang vân đá Cẩm Thạch',
    description: 'Sự pha trộn tuyệt mỹ của màu sơn nước tạo nên những đường vân đá sang trọng.',
    imageUrl: 'https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Làn khói sắc màu rực rỡ',
    description: 'Cận cảnh đốm khói màu nghệ thuật tương phản sống động trên nền đen bí ẩn.',
    imageUrl: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Vật thể 3D Hologram phản quang',
    description: 'Thiết kế đồ họa 3D hiện đại với ánh sáng bảy sắc cầu vồng bắt mắt.',
    imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Tranh sơn dầu vân màu nổi',
    description: 'Các nét cọ dày mộc mạc và phối màu tươi sáng tạo cảm hứng sáng tạo mạnh mẽ.',
    imageUrl: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Đèn Neon rực rỡ sắc màu',
    description: 'Những dải đèn ống neon uốn lượn phong cách retro của thành phố tương lai.',
    imageUrl: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Hình học trừu tượng Geometric',
    description: 'Cấu trúc khối đường nét hiện đại cho hình nền máy tính ấn tượng.',
    imageUrl: 'https://images.unsplash.com/photo-1550859492-d5da9d8e45f3?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Thủy tinh lỏng chuyển sắc cầu vồng',
    description: 'Nghệ thuật mô phỏng chất liệu lỏng lung linh đầy tính nghệ thuật kỹ thuật số.',
    imageUrl: 'https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Thung lũng mơ mộng Surrealism',
    description: 'Một tác phẩm hội họa siêu thực gợi mở không gian tưởng tượng vô hạn.',
    imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Màu nước loang lổ nghệ thuật',
    description: 'Tác phẩm phác họa bằng màu nước nhẹ nhàng bay bổng đầy tinh tế.',
    imageUrl: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Vaporwave Sunset rực rỡ sắc tím',
    description: 'Phong cách retro hoài niệm hoàng hôn thập niên 80 lãng mạn.',
    imageUrl: 'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Bàn phím cơ Custom đèn LED Neon',
    description: 'Bàn phím cơ sành điệu với bộ phím custom nổi bật cá tính.',
    imageUrl: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Bo mạch chủ PC phát sáng',
    description: 'Công nghệ phần cứng hiện đại với hệ thống ánh sáng RGB cực chất.',
    imageUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Góc làm việc chuẩn Coder / Developer',
    description: 'Góc setup làm việc tối giản với 2 màn hình lớn hiển thị đầy mã nguồn code.',
    imageUrl: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Ngõ hẻm Cyberpunk ở Tokyo',
    description: 'Những bảng hiệu neon sáng rực phản chiếu mặt đường ướt mưa đầy bí ẩn.',
    imageUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Kính thực tế ảo VR đỉnh cao',
    description: 'Trải nghiệm công nghệ thế giới ảo siêu thực đầy sống động.',
    imageUrl: 'https://images.unsplash.com/photo-1593508512255-86ab42a8e620?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Góc học tập tối giản Minimalist Desk',
    description: 'Bàn làm việc sáng sủa thanh lịch với máy tính iMac và bình hoa nhỏ.',
    imageUrl: 'https://images.unsplash.com/photo-1499951360447-b19be8fe80f5?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Giao diện ba chiều Hologram khoa học',
    description: 'Công nghệ trình chiếu ảo ảnh viễn tưởng thường thấy trong phim Marvel.',
    imageUrl: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Máy chơi game thùng cổ điển Arcade',
    description: 'Ký ức tuổi thơ ùa về với chiếc máy chơi game xèng sắc màu ấm cúng.',
    imageUrl: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Công nghệ Smart Home hiện đại',
    description: 'Điều khiển ánh sáng và âm nhạc toàn ngôi nhà qua trợ lý ảo thông minh.',
    imageUrl: 'https://images.unsplash.com/photo-1558002038-1055907df827?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Trí Tuệ Nhân Tạo AI phát sáng',
    description: 'Minh họa mạng lưới nơ-ron thần kinh nhân tạo siêu việt.',
    imageUrl: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Màn hình hiển thị mã nguồn phát sáng',
    description: 'Vẻ đẹp của các dòng code lập trình lấp lánh trong đêm tối.',
    imageUrl: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Abstract 3D Fluid Art',
    description: 'Sự hòa quyện chuyển động mềm mại của chất lỏng 3D rực rỡ.',
    imageUrl: 'https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Giá sách thông minh tối giản',
    description: 'Thiết kế lưu trữ sách thông minh gọn gàng cho phòng đọc hiện đại.',
    imageUrl: 'https://images.unsplash.com/photo-1580273916550-e323be2ae537?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Căn phòng lập trình viên ngập tràn đèn LED',
    description: 'Góc giải trí lý tưởng cho game thủ với ánh sáng neon đổi màu linh hoạt.',
    imageUrl: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },
  {
    title: 'Nghệ thuật điêu khắc số 3D',
    description: 'Bức tượng cổ điển kết hợp hiệu ứng glitch nghệ thuật kỹ thuật số.',
    imageUrl: 'https://images.unsplash.com/photo-1561736778-92e52a7769ef?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-3',
  },

  // ==========================================
  // EMILY_FASHION (sample-user-id-4) - Fashion & Cars (25 Pins)
  // ==========================================
  {
    title: 'Nhẫn vàng tối giản Minimalist Rings',
    description: 'Phụ kiện trang sức thanh lịch làm điểm nhấn cho trang phục hàng ngày.',
    imageUrl: 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Áo khoác Streetwear năng động',
    description: 'Phong cách thời trang đường phố trẻ trung phóng khoáng và cá tính.',
    imageUrl: 'https://images.unsplash.com/photo-1552374196-1ab2a1c593e8?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Chân dung kính râm Vintage cổ điển',
    description: 'Kính râm gọng kim loại phong cách hoài cổ lãng mạn đầy cuốn hút.',
    imageUrl: 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Tủ treo quần áo tông màu Pastel',
    description: 'Tủ đồ được sắp xếp ngăn nắp theo gam màu dịu mắt đầy cảm hứng.',
    imageUrl: 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Giày bốt da cao cấp cá tính',
    description: 'Giày bốt da cổ điển bền bỉ, thời trang cho những chuyến đi phiêu lưu.',
    imageUrl: 'https://images.unsplash.com/photo-1520639888713-7851133b1ed0?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Váy thiết kế thời trang High Fashion',
    description: 'Váy dài dạ hội lộng lẫy thướt tha trong buổi chụp hình studio chuyên nghiệp.',
    imageUrl: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Chi tiết đồng hồ đeo tay cơ nam tính',
    description: 'Đồng hồ cơ mặt kính sapphire tinh xảo sắc nét khẳng định đẳng cấp.',
    imageUrl: 'https://images.unsplash.com/photo-1524592094714-0f0654e20314?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Áo măng tô dạ mùa đông thời thượng',
    description: 'Mặc đẹp ấm áp ngày lạnh với áo măng tô dạ dáng dài thanh lịch.',
    imageUrl: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Khay mỹ phẩm trang điểm ngăn nắp',
    description: 'Tông son đỏ quyến rũ và cọ phấn mềm mịn sắp xếp đầy nghệ thuật.',
    imageUrl: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Áo khoác Denim bò trẻ trung',
    description: 'Mẫu áo khoác denim không bao giờ lỗi mốt cho phong cách năng động bụi bặm.',
    imageUrl: 'https://images.unsplash.com/photo-1576995853123-5a10305d93c0?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Siêu xe thể thao Porsche cổ điển đỏ rực',
    description: 'Dòng xe cổ huyền thoại Porsche 911 sừng sững dưới nắng chiều.',
    imageUrl: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Siêu xe điện tương lai Tesla Roadster',
    description: 'Kiệt tác khí động học với những đường cong sắc sảo đầy tương lai.',
    imageUrl: 'https://images.unsplash.com/photo-1617788138017-80ad40651399?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Mô tô phân khối lớn Cafe Racer bụi bặm',
    description: 'Chiếc xe custom đậm chất phong trần đậu trong gara sửa xe ấm cúng.',
    imageUrl: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Xe đua Drift phát sáng dưới ánh đèn Neon',
    description: 'Khoảnh khắc drift xe đỉnh cao để lại vệt lốp khói đầy ấn tượng.',
    imageUrl: 'https://images.unsplash.com/photo-1542282088-fe8426682b8f?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Xe cắm trại Volkswagen Camper Van',
    description: 'Chuyến dã ngoại du mục hoàn hảo bên chiếc xe van huyền thoại.',
    imageUrl: 'https://images.unsplash.com/photo-1527689368864-3a821dbccc34?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Lái xe trên đường cao tốc lúc hoàng hôn',
    description: 'Khung cảnh lãng mạn nhìn từ khoang lái vô lăng hướng về chân trời đỏ rực.',
    imageUrl: 'https://images.unsplash.com/photo-1563720223185-11003d516935?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Siêu xe thể thao màu xám mờ hiện đại',
    description: 'Mẫu xe sang bóng bẩy đậu bên ngoài biệt thự kính hiện đại tối tân.',
    imageUrl: 'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Vô lăng da sang trọng của xe Mercedes',
    description: 'Chi tiết thiết kế nội thất cao cấp của dòng xe sedan hạng sang.',
    imageUrl: 'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Xe Vespa cổ đỏ rực bên phố Rome',
    description: 'Vẻ đẹp lãng mạn đậm chất Ý với chiếc Vespa đậu bên mảng tường hoa leo cổ kính.',
    imageUrl: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Đầu máy xe lửa hơi nước cổ xưa',
    description: 'Vẻ đẹp cơ khí đầy hoài cổ của chiếc xe lửa phun khói trắng băng qua thung lũng.',
    imageUrl: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Túi xách da nữ sang trọng thanh lịch',
    description: 'Phụ kiện thời trang cao cấp bằng chất liệu da thuộc tinh tế tôn vóc dáng.',
    imageUrl: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Bộ suit công sở nam lịch lãm',
    description: 'Trang phục veston may đo tinh xảo cho quý ông hiện đại đĩnh đạc.',
    imageUrl: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Kính mát phi công thời thượng',
    description: 'Phụ kiện kính mát phi công (aviator) kinh điển bảo vệ mắt và cực ngầu.',
    imageUrl: 'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Xe thể thao mui trần dạo biển',
    description: 'Trải nghiệm vi vu trên xe mui trần lộng gió bên cung đường ven biển mát rượi.',
    imageUrl: 'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },
  {
    title: 'Kệ giày Sneaker hàng hiệu đồ sộ',
    description: 'Ước mơ của các đầu giày (sneakerheads) với đầy đủ các mẫu Jordan, Yeezy.',
    imageUrl: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-4',
  },

  // ==========================================
  // LUCAS_ACOUSTICS (sample-user-id-5) - Acoustics & Sound (25 Pins)
  // ==========================================
  {
    title: 'Đầu đĩa than Vintage cổ điển',
    description: 'Trải nghiệm âm thanh analog ấm áp và mộc mạc bên đĩa nhạc cổ xưa.',
    imageUrl: 'https://images.unsplash.com/photo-1539650116574-8efeb43e2750?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Tai nghe kiểm âm cao cấp',
    description: 'Độ chi tiết âm thanh hoàn hảo chuyên nghiệp cho phòng thu.',
    imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Micro thu âm cổ điển',
    description: 'Thiết kế kim loại sang trọng hoài niệm phong cách thập niên 50.',
    imageUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Bàn trộn âm thanh Mixer chuyên nghiệp',
    description: 'Trái tim điều khiển và cân bằng tần số của mọi phòng thu âm.',
    imageUrl: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Hệ thống loa Hi-Fi gia đình',
    description: 'Thưởng thức âm nhạc độ phân giải cao tại không gian phòng khách.',
    imageUrl: 'https://images.unsplash.com/photo-1618042164219-62c820f10723?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Phòng thu âm Soundproof Studio',
    description: 'Không gian xử lý âm học hoàn hảo được lót tấm tiêu âm gỗ.',
    imageUrl: 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Guitar Acoustic gỗ mun',
    description: 'Mộc mạc, sâu lắng trong từng nốt nhạc của đàn guitar mộc.',
    imageUrl: 'https://images.unsplash.com/photo-1545454675-3531b543be5d?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Kèn Saxophone đồng thau',
    description: 'Âm thanh Jazz quyến rũ dưới ánh đèn sân khấu buổi đêm.',
    imageUrl: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Bàn phím cơ Synthesizer',
    description: 'Sáng tạo những dải âm thanh điện tử độc đáo ấn tượng.',
    imageUrl: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Đĩa nhạc Vinyl màu sắc',
    description: 'Nghệ thuật trưng bày đĩa than đầy màu sắc hoài cổ.',
    imageUrl: 'https://images.unsplash.com/photo-1506157786151-b8491531f063?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Băng Cassette hoài niệm',
    description: 'Ký ức âm nhạc thập niên 90 gói gọn trong cuộn băng.',
    imageUrl: 'https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Tai nghe chụp tai chống ồn',
    description: 'Đắm chìm hoàn toàn vào thế giới âm thanh của bạn.',
    imageUrl: 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Phím Đàn Piano Hoàng Gia',
    description: 'Nơi khởi nguồn những giai điệu cổ điển bất hủ.',
    imageUrl: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Nội thất gỗ phòng nghe nhạc',
    description: 'Thiết kế hòa quyện giữa thẩm mỹ và âm học tiêu âm.',
    imageUrl: 'https://images.unsplash.com/photo-1520166012956-add9ba0835cb?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Bộ trống Jazz chuyên nghiệp',
    description: 'Nhịp điệu bùng nổ trên sân khấu nhạc sống hoành tráng.',
    imageUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Nghệ sĩ Violin đường phố',
    description: 'Giai điệu lãng mạn vang vọng góc phố cổ Paris yên bình.',
    imageUrl: 'https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Máy Cassette Walkman bỏ túi',
    description: 'Phong cách thưởng thức nhạc di động cổ điển thập niên cũ.',
    imageUrl: 'https://images.unsplash.com/photo-1506157786151-b8491531f063?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Dải sóng âm thanh Waveform',
    description: 'Vẻ đẹp trừu tượng hiển thị tần số âm thanh kỹ thuật số.',
    imageUrl: 'https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Sheet nhạc cổ điển úa màu',
    description: 'Những nốt nhạc cổ xưa chứa đựng nét thời gian thơ mộng.',
    imageUrl: 'https://images.unsplash.com/photo-1507838153414-b4b713384a76?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Hòa âm ánh sáng buổi Concert',
    description: 'Sự kết hợp hoàn hảo giữa âm thanh sống động và ánh sáng.',
    imageUrl: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Dây đàn Guitar Điện căng tràn',
    description: 'Sẵn sàng cho những giai điệu Rock máu lửa hoành tráng.',
    imageUrl: 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Đài Radio bóng đèn cổ',
    description: 'Thu sóng những tần số ký ức xa xưa trầm mặc.',
    imageUrl: 'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Bàn xoay DJ chớp nháy neon',
    description: 'Nơi kiến tạo năng lượng điện tử cho các bữa tiệc.',
    imageUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Micro hát Karaoke không dây',
    description: 'Giải trí âm nhạc cùng bạn bè ngày cuối tuần vui vẻ.',
    imageUrl: 'https://images.unsplash.com/photo-1590602847861-f357a9332bbc?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Nhà hát Opera tráng lệ',
    description: 'Thiết kế kiến trúc âm học mái vòm đỉnh cao nhân loại.',
    imageUrl: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },

  // ==========================================
  // MEME_LORD (sample-user-id-6) - Meme & Funny (25 Pins)
  // ==========================================
  {
    title: 'Mèo đeo kính cực ngầu',
    description: 'Khi bạn biết mình đẹp trai và không cần cố gắng thu hút ai.',
    imageUrl: 'https://images.unsplash.com/photo-1533738363-b7f9aef128ce?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Chó husky ngáo ngơ',
    description: 'Khuôn mặt ngơ ngác khi bạn nhận ra hôm nay mới là thứ Hai.',
    imageUrl: 'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Chó pug quấn chăn ấm',
    description: 'Tâm trạng tôi khi sếp bảo làm thêm giờ tối nay.',
    imageUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Cười tươi như hoa',
    description: 'Nụ cười của tôi khi nhận tin nhắn thông báo tinh tinh nhận lương.',
    imageUrl: 'https://images.unsplash.com/photo-1535930891776-0c2dfb7fda1a?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Mèo hốt hoảng bất ngờ',
    description: 'Ủa cái gì vậy? Ai ăn vụng đống hạt cát của tôi?',
    imageUrl: 'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Hai chú chó trò chuyện',
    description: 'Nghe bảo đoạn code đó chạy mượt mà trên máy của sếp thôi.',
    imageUrl: 'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Ngủ gục trên bàn làm việc',
    description: 'Deadline dí sát lưng nhưng cơn buồn ngủ dí mạnh mẽ hơn.',
    imageUrl: 'https://images.unsplash.com/photo-1513245543132-31f507417b26?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Bướm đậu trên mũi mèo',
    description: 'Đứng im nhịn thở không con bướm xinh đẹp bay mất bây giờ.',
    imageUrl: 'https://images.unsplash.com/photo-1526336024174-e58f5cdd8e13?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Ánh mắt tội lỗi ngây thơ',
    description: 'Không phải tôi cắn đôi giày đâu, tự nó rách ra đó chủ nhân!',
    imageUrl: 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Alpaca sành điệu cá tính',
    description: 'Mái tóc chuẩn soái ca này đủ làm bạn gục ngã chưa?',
    imageUrl: 'https://images.unsplash.com/photo-1589182373726-e4f658ab50f0?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Llama lè lưỡi trêu chọc',
    description: 'Lêu lêu, không chịu làm việc mà đòi có nhiều tiền.',
    imageUrl: 'https://images.unsplash.com/photo-1527362950785-f487a7c1fe48?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Sinh nhật cô đơn lặng lẽ',
    description: 'Chúc mừng sinh nhật tôi, một tuổi mới ngập tràn niềm vui.',
    imageUrl: 'https://images.unsplash.com/photo-1534361960057-19889db9621e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Sếp chó quyền lực tối cao',
    description: 'Chào cậu, cậu bị sa thải ngay vì tội không cho tôi ăn hạt.',
    imageUrl: 'https://images.unsplash.com/photo-1544568100-847a948585b9?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Sóc ăn bánh quy cực ngon',
    description: 'Mlem mlem, đồ ăn xin được lúc nào cũng thơm ngon lạ kỳ.',
    imageUrl: 'https://images.unsplash.com/photo-1504208434309-cb69f4fe52b0?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Heo đất mỉm cười đáng yêu',
    description: 'Nụ cười khi ví tiền của bạn vẫn còn nguyên 10k mua bánh mì.',
    imageUrl: 'https://images.unsplash.com/photo-1516467508483-a7212febe31a?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Dê cười khoe răng hài hước',
    description: 'Hehehe, tôi vừa nhai sạch vườn hoa hồng của nhà hàng xóm.',
    imageUrl: 'https://images.unsplash.com/photo-1518020382113-a7e8fc38eac9?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Mèo tập yoga vươn vai',
    description: 'Chào buổi sáng, vươn vai một cái cho sảng khoái cơ thể nào.',
    imageUrl: 'https://images.unsplash.com/photo-1519052537078-e6302a4968d4?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Ngỗng kêu um sùm đòi ăn',
    description: 'Tránh đường ra cho trẫm đi dạo quanh hồ nước!',
    imageUrl: 'https://images.unsplash.com/photo-1472491235688-bdc81a63246e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Khỉ gãi đầu bối rối suy nghĩ',
    description: 'Ủa rồi cái bug logic này từ đâu chui ra vậy ta?',
    imageUrl: 'https://images.unsplash.com/photo-1540573133985-87b6da6d54a9?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Mũ len ấm áp ngộ nghĩnh',
    description: 'Mẹ mặc ấm cho đi chơi, trông ngố không chịu nổi.',
    imageUrl: 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Mèo béo lười biếng ngủ ngày',
    description: 'Hôm nay tôi mệt mỏi, tôi chỉ muốn nằm dài ra ngủ thôi.',
    imageUrl: 'https://images.unsplash.com/photo-1516139008210-96e45dccd83b?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Meerkat hóng hớt drama',
    description: 'Ủa nghe đồn phòng marketing kế bên đang cãi nhau to lắm.',
    imageUrl: 'https://images.unsplash.com/photo-1503256207526-0d5d80fa2f47?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Gấu trúc lăn tròn ngộ nghĩnh',
    description: 'Đời là bể khổ, đi ngủ trốn tránh deadline cho lành.',
    imageUrl: 'https://images.unsplash.com/photo-1508817628294-5a453fa0b8fb?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Kitten ngáp ngủ siêu dễ thương',
    description: 'Buồn ngủ dí ríu mắt rồi, chúc cả nhà ngủ ngon nhé.',
    imageUrl: 'https://images.unsplash.com/photo-1592194996308-7b43878e84a6?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Vịt cười sảng khoái vui tươi',
    description: 'Haha, nghe câu chuyện hài của bạn kể vui quá đi mất.',
    imageUrl: 'https://images.unsplash.com/photo-1520315342629-6ea920342047?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },

  // ==========================================
  // ANIME, MANGA & TECH CULTURE (50 Pins) split between Lucas and Meme Lord
  // ==========================================
  {
    title: 'Đèn Neon màu tím mộng mơ',
    description: 'Hiệu ứng ánh sáng neon tím phong cách anime cyberpunk.',
    imageUrl: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Ngõ hẻm Tokyo ngập tràn ánh đèn',
    description: 'Con phố ẩm thực đêm lung linh đậm chất hoạt hình Nhật Bản.',
    imageUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Tay cầm chơi game cổ điển',
    description: 'Tay bấm điện tử gợi nhớ ký ức tuổi thơ chơi game bốn nút.',
    imageUrl: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Góc máy tính retro hoài cổ',
    description: 'Những màn hình CRT và đĩa mềm cổ điển những năm 90.',
    imageUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Mã nguồn nhị phân ma trận',
    description: 'Hình nền ma trận số xanh lá đậm chất hacker công nghệ.',
    imageUrl: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Hình minh họa Kiếm Sĩ Anime',
    description: 'Tác phẩm phác họa phong cách kiếm sĩ hoạt họa cực ngầu.',
    imageUrl: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Mô hình nhân vật Anime nữ',
    description: 'Mô hình PVC tinh xảo được trưng bày lộng lẫy trên tủ kính.',
    imageUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Bảng hiệu Neon Tokyo rực rỡ',
    description: 'Các bảng hiệu chữ Nhật sáng rực góc phố Kabukicho.',
    imageUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Chú chó Shiba phong cách Anime',
    description: 'Nghệ thuật phác họa chú chó Shiba đeo khăn đỏ đáng yêu.',
    imageUrl: 'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Điêu khắc 3D nghệ thuật trừu tượng',
    description: 'Khối hình học lỏng lấp lánh phản chiếu đa chiều.',
    imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Khung truyện tranh Manga thô',
    description: 'Bản vẽ tay phác thảo các nhân vật manga bằng bút mực.',
    imageUrl: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Màn hình máy chơi game Arcade xập xình',
    description: 'Góc máy game thùng cổ điển rực rỡ sắc màu thập niên 80.',
    imageUrl: 'https://images.unsplash.com/photo-1533105079780-92b9be482077?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Mạch điện tử phát sáng xanh lá',
    description: 'Cận cảnh đường chạy vi mạch công nghệ cao tinh xảo.',
    imageUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Màn hình code lập trình viên ban đêm',
    description: 'Góc làm việc chìm trong bóng tối với màn hình phát sáng.',
    imageUrl: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Hẻm nhỏ rực rỡ Cyberpunk Tokyo',
    description: 'Con phố nhỏ chật hẹp ngập tràn ánh đèn quảng cáo.',
    imageUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Góc làm việc lập trình tối giản',
    description: 'Bàn làm việc gỗ sồi sang trọng và máy tính cao cấp.',
    imageUrl: 'https://images.unsplash.com/photo-1499951360447-b19be8fe80f5?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Bảng mã nhị phân màu xanh',
    description: 'Những con số 0 và 1 chạy dài tượng trưng cho thế giới số.',
    imageUrl: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Cận cảnh nút bấm tay cầm game',
    description: 'Tay cầm gaming chuyên nghiệp hiện đại cực nhạy.',
    imageUrl: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Góc phòng ngủ Gaming Neon',
    description: 'Không gian lý tưởng của game thủ với dải đèn LED RGB.',
    imageUrl: 'https://images.unsplash.com/photo-1558002038-1055907df827?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Kính thực tế ảo VR hiện đại',
    description: 'Thiết bị VR mở ra không gian thế giới ảo metaverse.',
    imageUrl: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Nghệ thuật đĩa than trừu tượng',
    description: 'Vòng xoay đĩa hát đính họa tiết đồ họa độc đáo.',
    imageUrl: 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Thời trang đường phố Tokyo năng động',
    description: 'Trang phục streetwear kết hợp phong cách Harajuku.',
    imageUrl: 'https://images.unsplash.com/photo-1552374196-1ab2a1c593e8?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Kính mát đen cực chất',
    description: 'Phụ kiện thời trang mắt kính đen phản quang thời thượng.',
    imageUrl: 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Bộ trang phục cá tính nổi bật',
    description: 'Phong cách phối đồ unisex trẻ trung và hiện đại.',
    imageUrl: 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Căn hộ chung cư gác mái tối giản',
    description: 'Không gian sống hiện đại tràn ngập ánh sáng tự nhiên.',
    imageUrl: 'https://images.unsplash.com/photo-1520639888713-7851133b1ed0?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-5',
  },
  {
    title: 'Cửa hàng quần áo thiết kế rực rỡ',
    description: 'Nội thất bài trí sang trọng ấm cúng đầy tính thời trang.',
    imageUrl: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Chân dung cô gái vintage hoài cổ',
    description: 'Ánh mắt đầy tâm trạng dưới nắng chiều thơ mộng.',
    imageUrl: 'https://images.unsplash.com/photo-1524592094714-0f0654e20314?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Thời trang nam đường phố sành điệu',
    description: 'Phong cách cá tính kết hợp mũ len và áo khoác bomber.',
    imageUrl: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Phấn trang điểm mắt pastel',
    description: 'Khay màu mắt trang điểm tươi sáng cá tính rực rỡ.',
    imageUrl: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Siêu xe thể thao độ gầm cực ngầu',
    description: 'Chiếc xe drift sành điệu tỏa sáng dưới ánh đèn hầm xe.',
    imageUrl: 'https://images.unsplash.com/photo-1576995853123-5a10305d93c0?w=800&auto=format&fit=crop',
},
  {
    title: 'Chiếc Vespa cổ bên phố cổ hoa leo',
    description: 'Vẻ đẹp lãng mạn đậm chất điện ảnh cổ điển Ý.',
    imageUrl: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Đầu máy xe lửa hơi nước Hogwarts Express',
    description: 'Chiếc tàu phun khói trắng băng qua thung lũng xanh mướt.',
    imageUrl: 'https://images.unsplash.com/photo-1541417904950-b855846fe074?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Son môi đỏ Chanel quý phái',
    description: 'Bộ mỹ phẩm trang điểm hàng hiệu sang trọng thanh lịch.',
    imageUrl: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Vest nam may đo hoàn hảo lịch lãm',
    description: 'Trang phục chuẩn quý ông thành đạt đĩnh đạc cuốn hút.',
    imageUrl: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Kính Aviator phi công cổ điển',
    description: 'Chiếc kính râm huyền thoại của các phi công bầu trời.',
    imageUrl: 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Siêu xe điện thể thao dạo biển',
    description: 'Cảm giác lái tự do vi vu ngập tràn ánh nắng và gió biển.',
    imageUrl: 'https://images.unsplash.com/photo-1617788138017-80ad40651399?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Tủ Sneaker khổng lồ đáng mơ ước',
    description: 'Góc trưng bày giày thể thao cực chất cho các sneakerhead.',
    imageUrl: 'https://images.unsplash.com/photo-1552374196-1ab2a1c593e8?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Thảm cỏ xanh đọng sương mai',
    description: 'Sự trong lành tĩnh lặng của buổi sáng sớm tràn ngập nắng ấm.',
    imageUrl: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Mô hình đất sét Kawaii cực dễ thương',
    description: 'Thiết kế đồ chơi nghệ thuật đất sét 3D phong cách chibi.',
    imageUrl: 'https://images.unsplash.com/photo-1593085512500-5d55148d6f0d?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Góc chơi game màn hình cong Ultrawide',
    description: 'Bố cục phần cứng PC tối tân cho game thủ chuyên nghiệp.',
    imageUrl: 'https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Máy chơi game NES Nintendo bốn nút',
    description: 'Hộp tay cầm và băng game kỷ niệm của thời thế hệ 8x 9x.',
    imageUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
  {
    title: 'Tượng Hy Lạp Glitch Art phong cách Manga',
    description: 'Sự giao thoa độc đáo giữa nghệ thuật phục hưng và hiện đại kỹ thuật số.',
    imageUrl: 'https://images.unsplash.com/photo-1606744824163-985d376605aa?w=800&auto=format&fit=crop',
    userId: 'sample-user-id-6',
  },
];

async function main() {
  console.log('Bắt đầu chạy Seed dữ liệu PostgreSQL cho Supabase...');

  // 1. Tạo 5 người dùng mẫu nếu chưa tồn tại
  console.log('Tạo/Cập nhật các người dùng mẫu...');
  for (const userData of seedUsers) {
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
  console.log('Đã hoàn thành tạo/cập nhật 5 người dùng mẫu.');

  // 2. Để tránh trùng lặp dữ liệu ghim cũ khi chạy lại seed, xóa các ghim do 5 user mẫu này tạo trước đó
  console.log('Dọn dẹp các ghim cũ của các tài khoản mẫu...');
  const userIds = seedUsers.map((u) => u.id);
  await prisma.pin.deleteMany({
    where: {
      userId: { in: userIds },
    },
  });

  // 3. Tiến hành chèn 200 ghim ảnh mẫu chất lượng cao vào DB
  console.log(`Tiến hành chèn ${pinsData.length} ghim ảnh mẫu từ Unsplash...`);
  let count = 0;
  for (const pin of pinsData) {
    let category = 'other';
    if (pin.userId === 'sample-user-id-1') {
      category = 'nature';
    } else if (pin.userId === 'sample-user-id-2') {
      category = 'food';
    } else if (pin.userId === 'sample-user-id-3') {
      category = 'art';
    } else if (pin.userId === 'sample-user-id-4') {
      category = 'fashion';
    } else if (pin.userId === 'sample-user-id-5') {
      if (count >= 100 && count < 125) {
        category = 'acoustics';
      } else {
        category = 'anime';
      }
    } else if (pin.userId === 'sample-user-id-6') {
      if (count >= 125 && count < 150) {
        category = 'meme';
      } else {
        category = 'anime';
      }
    }

    await prisma.pin.create({
      data: {
        title: pin.title,
        description: pin.description,
        imageUrl: pin.imageUrl,
        userId: pin.userId!,
        isAiGenerated: false,
        category: category,
      },
    });
    count++;
  }
  console.log(`Đã chèn thành công ${count} ghim ảnh mẫu vào cơ sở dữ liệu!`);

  console.log('Quá trình Seed dữ liệu hoàn tất thành công tốt đẹp.');
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
