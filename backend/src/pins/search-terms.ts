/**
 * Từ điển khái niệm Việt → Anh cho ô tìm kiếm.
 *
 * VÌ SAO CẦN: thư viện ảnh trộn hai ngôn ngữ — 458 ảnh có tiêu đề tiếng Anh
 * (nạp từ Unsplash) và 1.104 ảnh tiêu đề tiếng Việt. Người dùng gõ "chó" thì
 * không bao giờ thấy ảnh chó đặt tên "Golden retriever puppy", dù nó nằm ngay
 * đó. Ngược lại gõ "dog" cũng không ra ảnh tiêu đề tiếng Việt.
 *
 * Từ điển này mở rộng câu tìm sang cả hai chiều, nên gõ tiếng nào cũng ra đủ.
 *
 * Nó CÒN giúp cả nhánh tìm theo ngữ nghĩa (CLIP): bộ mã hoá chữ của CLIP huấn
 * luyện chủ yếu trên tiếng Anh, nên câu tiếng Việt cho vector kém chính xác.
 * Dịch sang tiếng Anh trước khi lấy vector thì kết quả sát hơn hẳn.
 *
 * Giữ ở mức thủ công có chọn lọc: chỉ những khái niệm thật sự hay được tìm
 * trên một app ảnh. Bảng dịch tự động sẽ kéo theo vô số từ sai ngữ cảnh.
 */
const VI_EN: Record<string, string[]> = {
  // Động vật
  cho: ['dog', 'puppy'],
  meo: ['cat', 'kitten'],
  chim: ['bird'],
  ca: ['fish'],
  ngua: ['horse'],
  ho: ['tiger'],
  gau: ['bear'],
  tho: ['rabbit', 'bunny'],
  'thu cung': ['pet'],

  // Người
  nguoi: ['person', 'people'],
  'con gai': ['girl', 'woman'],
  'con trai': ['boy', 'man'],
  'em be': ['baby'],
  'chan dung': ['portrait'],
  toc: ['hair', 'hairstyle'],
  'trang diem': ['makeup'],

  // Ăn uống
  'do an': ['food', 'meal'],
  'thuc an': ['food'],
  banh: ['cake', 'pastry'],
  'ca phe': ['coffee'],
  tra: ['tea'],
  'trai cay': ['fruit'],
  hoa: ['flower'],

  // Cảnh vật
  'phong canh': ['landscape', 'scenery'],
  bien: ['sea', 'ocean', 'beach'],
  nui: ['mountain'],
  rung: ['forest'],
  troi: ['sky'],
  may: ['cloud'],
  'hoang hon': ['sunset'],
  'binh minh': ['sunrise'],
  dem: ['night'],
  mua: ['rain'],
  tuyet: ['snow'],
  'thanh pho': ['city', 'urban'],
  duong: ['street', 'road'],

  // Đồ vật
  xe: ['car', 'vehicle'],
  'xe hoi': ['car'],
  'xe may': ['motorbike', 'motorcycle'],
  'xe dap': ['bicycle', 'bike'],
  nha: ['house', 'home'],
  phong: ['room', 'interior'],
  sach: ['book'],
  'dien thoai': ['phone'],
  'may tinh': ['computer', 'laptop'],
  'quan ao': ['clothes', 'fashion', 'outfit'],
  giay: ['shoes'],
  'dong ho': ['watch', 'clock'],

  // Phong cách / chủ đề
  anime: ['anime', 'manga'],
  'hoat hinh': ['cartoon', 'animation'],
  'nghe thuat': ['art'],
  tranh: ['painting', 'artwork'],
  'de thuong': ['cute'],
  'toi gian': ['minimal', 'minimalist'],
  'co dien': ['vintage', 'classic'],
  'the thao': ['sport', 'fitness', 'gym'],
  'du lich': ['travel'],

  // Màu
  do: ['red'],
  xanh: ['blue', 'green'],
  vang: ['yellow', 'gold'],
  den: ['black'],
  trang: ['white'],
  hong: ['pink'],
  tim: ['purple'],
  cam: ['orange'],

  // Cách gọi hằng ngày — người ta gõ "gái", "trai", "chó cute", không gõ
  // "con gái" đầy đủ như bảng ở trên. Thiếu mấy mục này thì câu tìm phổ biến
  // nhất lại là câu duy nhất không nở ra được.
  gai: ['girl', 'woman', 'female'],
  trai: ['boy', 'man', 'male'],
  'gai xinh': ['beautiful girl', 'pretty woman', 'portrait'],
  sexy: ['model', 'glamour', 'portrait', 'fashion'],
  'nguoi mau': ['model', 'fashion'],
  cute: ['cute', 'adorable'],
  'hinh nen': ['wallpaper', 'background'],
  'nen': ['background', 'wallpaper'],
  'noi that': ['interior', 'furniture'],
  'oto': ['car'],
  'meo con': ['kitten'],
  'cho con': ['puppy'],
  'bau troi': ['sky'],
  'ban dem': ['night'],
  'mua he': ['summer'],
  'mua dong': ['winter'],
  'giang sinh': ['christmas'],
  'sinh nhat': ['birthday'],
  'dam cuoi': ['wedding'],
  'hinh xam': ['tattoo'],
  'mong tay': ['nail', 'nails'],
  'trang tri': ['decor', 'decoration'],
  'hoc tap': ['study', 'desk'],
  'vu tru': ['space', 'galaxy', 'universe'],
  'game': ['game', 'gaming'],
  'phim': ['movie', 'film', 'cinema'],
  'xe co': ['vehicle', 'cars'],
  'thien nhien': ['nature'],
  'kien truc': ['architecture', 'building'],
  'dong vat': ['animal', 'animals'],
  'am nhac': ['music', 'acoustics'],

  // Nhãn danh mục -> mã danh mục trong CSDL. Nút gợi ý lọc hiện chữ tiếng Việt
  // ("Tranh vẽ") nhưng cột `category` lưu mã tiếng Anh ("drawing"); thiếu cầu
  // nối này thì bấm nút xong tìm không ra gì.
  'tranh ve': ['drawing', 'painting', 'artwork'],
  'thoi trang': ['fashion'],
  'cong nghe': ['tech', 'technology'],
  'the hinh': ['fitness', 'gym'],
  'lam dep': ['beauty', 'makeup'],
  'cau noi': ['quotes', 'quote'],
};

/** Chiều ngược lại, dựng tự động từ bảng trên. */
const EN_VI: Record<string, string[]> = {};
for (const [vi, ens] of Object.entries(VI_EN)) {
  for (const en of ens) (EN_VI[en] ??= []).push(vi);
}

/** Bỏ dấu + thường hoá. Phải khớp hàm pinhub_norm() trong Postgres. */
export function normalizeVi(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

/**
 * Nở câu tìm ra các từ tương đương để tìm được cả hai ngôn ngữ.
 * Trả về danh sách từ khoá ĐÃ bỏ dấu, luôn có bản gốc đứng đầu.
 */
export function expandQuery(raw: string): string[] {
  const norm = normalizeVi(raw);
  if (!norm) return [];

  const out = new Set<string>([norm]);

  // Khớp nguyên câu trước (bắt được cụm hai chữ như "do an", "phong canh")
  for (const t of VI_EN[norm] ?? []) out.add(t);
  for (const t of EN_VI[norm] ?? []) out.add(t);

  // Rồi tới từng chữ, cho câu nhiều từ như "meo den"
  const words = norm.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    for (const w of words) {
      out.add(w);
      for (const t of VI_EN[w] ?? []) out.add(t);
      for (const t of EN_VI[w] ?? []) out.add(t);
    }
  }

  return [...out];
}

/**
 * Câu dùng để lấy vector CLIP — ưu tiên tiếng Anh vì bộ mã hoá chữ của CLIP
 * huấn luyện chủ yếu trên tiếng Anh.
 */
export function toEnglishHint(raw: string): string {
  const norm = normalizeVi(raw);
  const direct = VI_EN[norm];
  if (direct?.length) return direct[0];

  const words = norm.split(/\s+/).filter(Boolean);
  const mapped = words.map((w) => VI_EN[w]?.[0] ?? w);
  return mapped.join(' ') || raw;
}

/**
 * Nhãn tiếng Việt cho `Pin.category`. Danh mục nằm trong CSDL dưới dạng mã
 * tiếng Anh ("animals", "kpop"), nhưng thanh gợi ý lọc là thứ người dùng đọc,
 * nên phải dịch. Mã lạ chưa có ở đây thì rơi về chính nó viết hoa chữ đầu.
 */
const CATEGORY_LABELS: Record<string, string> = {
  animals: 'Động vật',
  nature: 'Thiên nhiên',
  anime: 'Anime',
  meme: 'Meme',
  fashion: 'Thời trang',
  food: 'Đồ ăn',
  drawing: 'Tranh vẽ',
  art: 'Nghệ thuật',
  kpop: 'K-pop',
  cars: 'Xe cộ',
  tech: 'Công nghệ',
  acoustics: 'Âm nhạc',
  fitness: 'Thể hình',
  architecture: 'Kiến trúc',
  sports: 'Thể thao',
  travel: 'Du lịch',
  beauty: 'Làm đẹp',
  quotes: 'Câu nói',
  wallpaper: 'Hình nền',
  other: 'Khác',
};

export function categoryLabel(key: string): string {
  if (!key) return 'Khác';
  return CATEGORY_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Bộ khái niệm dùng làm gợi ý lọc.
 *
 * VÌ SAO LÀ DANH SÁCH VIẾT TAY: bản đầu tách chữ từ tiêu đề và cho ra "màn",
 * "hình", "lập", "trình", "lucasacoustics" — mảnh vụn của một câu, bấm vào
 * chẳng ra chủ đề nào. Bản thứ hai lấy khoá của từ điển trên, đỡ hơn nhưng
 * vẫn lọt "phong", "cho", "do", "đen": tiếng Việt bỏ dấu một âm tiết thì
 * nghĩa gì cũng có, làm nhãn thì người đọc không hiểu đang lọc cái gì.
 *
 * Nên gợi ý chỉ lấy từ danh sách này: mỗi mục là một CHỦ ĐỀ tra được, và có
 * sẵn nhãn hiển thị đúng chính tả để đưa thẳng lên nút.
 */
const CONCEPT_TERMS: { norm: string; label: string }[] = [
  // Cụm tiếng Việt — cụ thể, đọc là hiểu ngay đang lọc gì
  { norm: 'phong canh', label: 'Phong cảnh' },
  { norm: 'hoang hon', label: 'Hoàng hôn' },
  { norm: 'binh minh', label: 'Bình minh' },
  { norm: 'bau troi', label: 'Bầu trời' },
  { norm: 'thien nhien', label: 'Thiên nhiên' },
  { norm: 'thanh pho', label: 'Thành phố' },
  { norm: 'ban dem', label: 'Ban đêm' },
  { norm: 'thu cung', label: 'Thú cưng' },
  { norm: 'dong vat', label: 'Động vật' },
  { norm: 'chan dung', label: 'Chân dung' },
  { norm: 'trang diem', label: 'Trang điểm' },
  { norm: 'quan ao', label: 'Quần áo' },
  { norm: 'de thuong', label: 'Dễ thương' },
  { norm: 'co dien', label: 'Cổ điển' },
  { norm: 'toi gian', label: 'Tối giản' },
  { norm: 'nghe thuat', label: 'Nghệ thuật' },
  { norm: 'hinh nen', label: 'Hình nền' },
  { norm: 'noi that', label: 'Nội thất' },
  { norm: 'kien truc', label: 'Kiến trúc' },
  { norm: 'du lich', label: 'Du lịch' },
  { norm: 'am nhac', label: 'Âm nhạc' },
  { norm: 'the thao', label: 'Thể thao' },
  { norm: 'trai cay', label: 'Trái cây' },
  { norm: 'ca phe', label: 'Cà phê' },
  { norm: 'do an', label: 'Đồ ăn' },
  { norm: 'em be', label: 'Em bé' },
  { norm: 'con gai', label: 'Con gái' },
  { norm: 'xe hoi', label: 'Xe hơi' },
  { norm: 'xe may', label: 'Xe máy' },
  { norm: 'hinh xam', label: 'Hình xăm' },
  { norm: 'giang sinh', label: 'Giáng sinh' },
  { norm: 'dam cuoi', label: 'Đám cưới' },
  { norm: 'hoat hinh', label: 'Hoạt hình' },

  // Tiếng Anh — không mơ hồ khi bỏ dấu nên giữ nguyên một từ được
  { norm: 'aesthetic', label: 'Aesthetic' },
  { norm: 'vintage', label: 'Vintage' },
  { norm: 'cute', label: 'Cute' },
  { norm: 'chibi', label: 'Chibi' },
  { norm: 'cosplay', label: 'Cosplay' },
  { norm: 'outfit', label: 'Outfit' },
  { norm: 'wallpaper', label: 'Wallpaper' },
  { norm: 'portrait', label: 'Portrait' },
  { norm: 'minimal', label: 'Minimal' },
  { norm: 'sunset', label: 'Sunset' },
  { norm: 'anime', label: 'Anime' },
  { norm: 'manga', label: 'Manga' },
  { norm: 'meme', label: 'Meme' },
  { norm: 'gym', label: 'Gym' },
  { norm: 'street', label: 'Street' },
  { norm: 'galaxy', label: 'Galaxy' },
];

/**
 * Đếm xem khái niệm nào thật sự xuất hiện trong tập kết quả, kèm một ảnh đại
 * diện. Chỉ trả về khái niệm CÓ ẢNH thật, để bấm vào không bao giờ ra trang
 * trắng — đây là điểm khác cốt lõi so với một danh sách gợi ý đoán mò.
 */
export function extractConcepts(
  pins: { title?: string | null; description?: string | null; imageUrl?: string | null; previewUrl?: string | null }[],
  exclude: string[],
  max = 12,
  /** Số lần xuất hiện tối thiểu, tính theo tỉ trọng của tập kết quả. Lọt vài
   *  tấm lẻ thì chưa phải chủ đề, chỉ là trùng chữ ngẫu nhiên. */
  minCount = 2,
): { label: string; count: number; imageUrl: string | null }[] {
  const skip = new Set(exclude.map(normalizeVi));
  const counts = new Map<string, { label: string; count: number; words: number; imageUrl: string | null }>();

  for (const pin of pins) {
    const hay = normalizeVi(`${pin.title ?? ''} ${pin.description ?? ''}`);
    if (!hay) continue;
    for (const { norm, label } of CONCEPT_TERMS) {
      if (skip.has(norm) || skip.has(normalizeVi(label))) continue;
      // Neo hai đầu từ: "gym" không được khớp trong "gymnastics".
      if (!new RegExp(`(^|[^a-z0-9])${norm}([^a-z0-9]|$)`).test(hay)) continue;
      const cur = counts.get(norm);
      if (cur) cur.count++;
      else
        counts.set(norm, {
          label,
          count: 1,
          words: norm.split(' ').length,
          imageUrl: pin.previewUrl || pin.imageUrl || null,
        });
    }
  }

  return [...counts.values()]
    .filter((c) => c.count >= minCount)
    .sort((a, b) => b.words - a.words || b.count - a.count)
    .slice(0, max)
    .map(({ label, count, imageUrl }) => ({ label, count, imageUrl }));
}

/**
 * Tách câu tìm thành các TỪ KHOÁ, mỗi từ kèm danh sách cách viết tương đương.
 *
 * VÌ SAO CẦN: trước đây câu tìm bị khớp NGUYÊN CỤM LIỀN NHAU. Nên khi người
 * dùng bấm một nút gợi ý và câu thành "code Ban đêm", không tiêu đề nào chứa
 * đúng chuỗi "code ban dem" — tìm kiếm rơi xuống nhánh khớp gần đúng và quét
 * bừa cả thư viện, cho ra ảnh chẳng liên quan. Pinterest tách từ rồi đòi ảnh
 * phải có ĐỦ mọi từ, nên bấm thêm nút là kết quả hẹp lại đúng hướng.
 *
 * Ghép cụm tham lam trước: "ban đêm" là một khái niệm, tách thành "ban" và
 * "đêm" thì "ban" khớp lung tung ("bàn", "bản", "ban công").
 */
export function tokenizeQuery(raw: string): string[][] {
  const norm = normalizeVi(raw);
  if (!norm) return [];
  const words = norm.split(/\s+/).filter(Boolean);

  const tokens: string[][] = [];
  let i = 0;
  while (i < words.length) {
    let matched = false;
    // Thử cụm 3 chữ rồi 2 chữ trước khi chịu lấy 1 chữ.
    for (let len = Math.min(3, words.length - i); len >= 2; len--) {
      const phrase = words.slice(i, i + len).join(' ');
      if (VI_EN[phrase] || EN_VI[phrase]) {
        tokens.push([phrase, ...(VI_EN[phrase] ?? []), ...(EN_VI[phrase] ?? [])]);
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const w = words[i];
    tokens.push([w, ...(VI_EN[w] ?? []), ...(EN_VI[w] ?? [])]);
    i++;
  }
  return tokens;
}
