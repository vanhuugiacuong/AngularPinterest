import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { ThemeToggle } from '../../shared/theme-toggle/theme-toggle';

type LegalDocumentType = 'terms' | 'privacy';

interface LegalSection {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

interface LegalDocument {
  label: string;
  title: string;
  summary: string;
  sections: LegalSection[];
}

const TERMS: LegalDocument = {
  label: 'Điều khoản Dịch vụ',
  title: 'Điều khoản Dịch vụ NovaFrame',
  summary:
    'Các điều khoản này quy định việc truy cập và sử dụng NovaFrame, gồm tài khoản, nội dung, công cụ AI, tương tác cộng đồng, gói thành viên và giao dịch hình ảnh.',
  sections: [
    {
      id: 'pham-vi',
      title: '1. Phạm vi áp dụng',
      paragraphs: [
        'Khi đăng nhập, truy cập hoặc sử dụng NovaFrame, bạn xác nhận đã đọc và đồng ý tuân thủ Điều khoản Dịch vụ này cùng Chính sách Bảo mật.',
        'Nếu bạn không đồng ý với các điều khoản này, bạn không nên tiếp tục đăng nhập hoặc sử dụng các chức năng yêu cầu tài khoản.',
      ],
    },
    {
      id: 'tai-khoan',
      title: '2. Tài khoản và đăng nhập',
      paragraphs: [
        'NovaFrame hiện sử dụng Google OAuth thông qua Supabase để xác thực. NovaFrame không cung cấp biểu mẫu mật khẩu riêng và không nhận mật khẩu Google của bạn.',
        'Bạn chịu trách nhiệm duy trì quyền kiểm soát tài khoản Google, bảo vệ phiên đăng nhập và cung cấp thông tin hồ sơ chính xác. Không được mạo danh người khác hoặc sử dụng tài khoản để né tránh biện pháp hạn chế đã áp dụng.',
      ],
    },
    {
      id: 'noi-dung',
      title: '3. Nội dung và quyền sở hữu trí tuệ',
      paragraphs: [
        'Bạn giữ các quyền hợp pháp đối với hình ảnh, mô tả, bình luận, tin nhắn và nội dung khác do mình tạo hoặc tải lên. Bạn chỉ được đăng nội dung khi có quyền sử dụng và chia sẻ nội dung đó.',
        'Để vận hành dịch vụ, bạn cấp cho NovaFrame quyền có giới hạn để lưu trữ, xử lý, tạo bản xem trước, áp dụng hình mờ, hiển thị và phân phối nội dung theo thiết lập hiển thị hoặc giao dịch do bạn chọn. Quyền này chỉ phục vụ việc cung cấp, bảo vệ và cải thiện các chức năng NovaFrame.',
      ],
      bullets: [
        'Không đăng nội dung xâm phạm bản quyền, quyền riêng tư, quyền hình ảnh hoặc quyền hợp pháp của bên thứ ba.',
        'Không gắn nguồn, mô tả, giá hoặc thông tin quyền sử dụng sai lệch.',
        'Không phát tán mã độc, nội dung lừa đảo hoặc nội dung bị pháp luật cấm.',
      ],
    },
    {
      id: 'ai',
      title: '4. Công cụ AI và tìm kiếm hình ảnh',
      paragraphs: [
        'NovaFrame có chức năng tạo ảnh bằng AI, lưu prompt và thông tin mô hình cho tác phẩm AI, đồng thời tạo vector đặc trưng để tìm kiếm nội dung tương tự.',
        'Kết quả AI có thể không chính xác, không độc nhất hoặc có điểm tương đồng với nội dung hiện có. Bạn phải kiểm tra kết quả trước khi công bố, bán hoặc sử dụng và chịu trách nhiệm về prompt, ảnh tham chiếu, mục đích sử dụng cùng quyền của bên thứ ba.',
      ],
    },
    {
      id: 'cong-dong',
      title: '5. Tương tác cộng đồng',
      paragraphs: [
        'NovaFrame cho phép thích, bình luận, theo dõi, nhắn tin, chặn và báo cáo người dùng. Bạn phải giao tiếp tôn trọng và không được quấy rối, đe dọa, phát tán thư rác, kích động thù ghét hoặc thu thập dữ liệu người khác trái phép.',
        'Tài khoản riêng tư và bảng bí mật giới hạn khả năng hiển thị trong giao diện, nhưng không thay thế trách nhiệm bảo vệ thông tin nhạy cảm của bạn.',
      ],
    },
    {
      id: 'thanh-vien',
      title: '6. Gói thành viên và thanh toán',
      paragraphs: [
        'Một số chức năng được giới hạn theo gói Free, Plus hoặc Pro. Giá, thời hạn, quyền lợi và nội dung chuyển khoản hiển thị tại thời điểm tạo yêu cầu thanh toán là thông tin áp dụng cho giao dịch đó.',
        'Gói chỉ được kích hoạt sau khi khoản thanh toán được hệ thống hoặc người có thẩm quyền xác minh. Bạn phải dùng đúng số tiền và mã đối chiếu được cung cấp để hạn chế lỗi ghi nhận.',
        'Không đủ dữ liệu để xác minh chính sách hủy và hoàn tiền trong mã nguồn hiện tại. Chính sách này cùng thông tin đầy đủ của đơn vị cung cấp phải được công bố trước khi NovaFrame nhận thanh toán thương mại.',
      ],
    },
    {
      id: 'giao-dich',
      title: '7. Mua bán và đấu giá hình ảnh',
      paragraphs: [
        'Người bán phải có quyền cung cấp hình ảnh và phải khai báo đúng giá, trạng thái bán cùng tài khoản nhận tiền. Người mua phải kiểm tra thông tin tác phẩm, phạm vi quyền sử dụng và số tiền trước khi thanh toán.',
        'Giá đặt trong phiên đấu giá phải đáp ứng giá khởi điểm và bước giá tối thiểu hiển thị. Không được thao túng giá, đặt giá giả, can thiệp kỹ thuật hoặc sử dụng nhiều tài khoản để tạo lợi thế không công bằng.',
        'Bản ghi giao dịch, mã đối chiếu, trạng thái thanh toán, lịch sử đấu giá và nhật ký thao tác có thể được lưu để thực hiện giao dịch, đối soát và xử lý tranh chấp.',
      ],
    },
    {
      id: 'xu-ly-vi-pham',
      title: '8. Kiểm duyệt và xử lý vi phạm',
      paragraphs: [
        'NovaFrame có thể giới hạn hiển thị, gỡ nội dung, tạm ngừng chức năng hoặc hạn chế tài khoản khi cần xử lý nội dung bị báo cáo, bảo vệ người dùng, bảo vệ hệ thống hoặc tuân thủ yêu cầu hợp pháp.',
        'Việc xử lý phải dựa trên dữ liệu có thể kiểm tra và mức độ vi phạm. Các quyền bắt buộc của người dùng theo pháp luật áp dụng không bị loại trừ bởi điều khoản này.',
      ],
    },
    {
      id: 'dich-vu',
      title: '9. Tính sẵn sàng và giới hạn dịch vụ',
      paragraphs: [
        'NovaFrame có thể bảo trì, sửa lỗi hoặc điều chỉnh chức năng. Dịch vụ AI, xác thực, lưu trữ, thanh toán và nội dung từ bên thứ ba có thể gián đoạn do hạ tầng nằm ngoài quyền kiểm soát trực tiếp của NovaFrame.',
        'NovaFrame không bảo đảm kết quả AI, doanh thu, khả năng bán tác phẩm hoặc việc mọi nội dung luôn sẵn có. Không nội dung nào trong điều khoản này loại trừ trách nhiệm mà pháp luật không cho phép loại trừ.',
      ],
    },
    {
      id: 'cham-dut',
      title: '10. Ngừng sử dụng và dữ liệu tài khoản',
      paragraphs: [
        'Bạn có thể đăng xuất để kết thúc phiên sử dụng. Mã nguồn hiện tại chưa có quy trình tự phục vụ để xóa toàn bộ tài khoản và dữ liệu liên quan; không đủ dữ liệu để xác minh thời hạn xử lý yêu cầu xóa.',
        'Trước khi phát hành chính thức, NovaFrame phải cung cấp kênh tiếp nhận yêu cầu về tài khoản, dữ liệu và tranh chấp, đồng thời nêu rõ dữ liệu nào cần tiếp tục lưu theo nghĩa vụ pháp lý hoặc giao dịch chưa hoàn tất.',
      ],
    },
    {
      id: 'thay-doi',
      title: '11. Thay đổi điều khoản',
      paragraphs: [
        'Khi điều khoản thay đổi đáng kể, phiên bản mới và ngày cập nhật phải được công bố rõ ràng trước khi áp dụng. Việc tiếp tục sử dụng sau thời điểm có hiệu lực được xem xét theo thông báo đã cung cấp và pháp luật áp dụng.',
      ],
    },
  ],
};

const PRIVACY: LegalDocument = {
  label: 'Chính sách Bảo mật',
  title: 'Chính sách Bảo mật NovaFrame',
  summary:
    'Chính sách này mô tả các nhóm dữ liệu NovaFrame đang xử lý, mục đích sử dụng, các dịch vụ liên quan và quyền kiểm soát dữ liệu của người dùng.',
  sections: [
    {
      id: 'pham-vi',
      title: '1. Phạm vi chính sách',
      paragraphs: [
        'Chính sách áp dụng cho dữ liệu được xử lý khi bạn truy cập NovaFrame, đăng nhập bằng Google, tạo hồ sơ, đăng tác phẩm, sử dụng AI, tương tác với người khác hoặc thực hiện giao dịch.',
        'Nội dung bạn chủ động công khai có thể được người dùng khác xem, lưu hoặc chia sẻ theo chức năng của dịch vụ. Nội dung trong bảng bí mật, tài khoản riêng tư và tin nhắn được giới hạn theo quyền truy cập tương ứng trong hệ thống.',
      ],
    },
    {
      id: 'du-lieu-thu-thap',
      title: '2. Dữ liệu được xử lý',
      paragraphs: [
        'Từ mã nguồn và cấu trúc dữ liệu hiện tại, NovaFrame xử lý các nhóm dữ liệu sau:',
      ],
      bullets: [
        'Dữ liệu xác thực và hồ sơ: mã người dùng, email, tên hiển thị, tên người dùng, ảnh đại diện, tiểu sử, ngày tạo tài khoản và trạng thái riêng tư.',
        'Nội dung sáng tạo: hình ảnh gốc và bản xem trước, tiêu đề, mô tả, nguồn, danh mục, bảng lưu, hình mờ, prompt, negative prompt và mô hình tạo ảnh.',
        'Dữ liệu tương tác: lượt thích, bình luận, theo dõi, yêu cầu theo dõi, tin nhắn, yêu cầu nhắn tin, chặn, báo cáo và thông báo.',
        'Dữ liệu gói và giao dịch: gói đang sở hữu, thời hạn gói, hạn mức AI, yêu cầu thanh toán, số tiền, mã đối chiếu, trạng thái, mã giao dịch nhà cung cấp, giao dịch ảnh, phiên đấu giá và lịch sử đặt giá.',
        'Dữ liệu nhận tiền của người bán: mã ngân hàng, số tài khoản và tên chủ tài khoản.',
        'Dữ liệu lưu trên thiết bị: lựa chọn giao diện, trạng thái nút đổi giao diện, lịch sử tìm kiếm và phiên xác thực do Supabase duy trì trong bộ nhớ trình duyệt.',
      ],
    },
    {
      id: 'muc-dich',
      title: '3. Mục đích xử lý',
      paragraphs: ['NovaFrame xử lý dữ liệu trong phạm vi cần thiết cho các mục đích sau:'],
      bullets: [
        'Xác thực, đồng bộ tài khoản và duy trì phiên đăng nhập.',
        'Hiển thị hồ sơ, tác phẩm, bảng lưu và các tương tác theo lựa chọn riêng tư của người dùng.',
        'Tạo ảnh AI, kiểm tra nội dung, tạo vector đặc trưng và cung cấp tìm kiếm văn bản hoặc tìm kiếm bằng hình ảnh.',
        'Cung cấp nhắn tin, thông báo, báo cáo, chặn và các công cụ an toàn cộng đồng.',
        'Quản lý quyền lợi gói, thanh toán, mua bán, đấu giá, đối soát và phòng ngừa giao dịch trùng lặp hoặc gian lận.',
        'Bảo vệ hệ thống, điều tra lỗi, thực thi điều khoản và đáp ứng yêu cầu hợp pháp.',
      ],
    },
    {
      id: 'dich-vu-lien-quan',
      title: '4. Dịch vụ và bên xử lý liên quan',
      paragraphs: [
        'NovaFrame hiện tích hợp Google và Supabase cho đăng nhập; Supabase cho kênh thời gian thực và lưu trữ; Pollinations.ai cho tạo ảnh; dịch vụ CLIP cho vector tìm kiếm; VietQR cho ảnh mã thanh toán; và SePay cho xác minh giao dịch khi được cấu hình.',
        'Dữ liệu được gửi đến từng dịch vụ phải giới hạn ở phần cần thiết cho chức năng tương ứng. Chính sách và điều kiện riêng của nhà cung cấp cũng có thể áp dụng khi bạn sử dụng chức năng đó.',
      ],
    },
    {
      id: 'cong-khai-chia-se',
      title: '5. Công khai và chia sẻ dữ liệu',
      paragraphs: [
        'Thông tin hồ sơ công khai, tác phẩm, mô tả, lượt thích, bình luận và quan hệ theo dõi có thể hiển thị cho người dùng khác theo thiết kế của từng chức năng và cài đặt riêng tư.',
        'Dữ liệu có thể được cung cấp cho nhà cung cấp hạ tầng nêu trên, cơ quan có thẩm quyền khi có yêu cầu hợp pháp, hoặc bên tham gia giao dịch trong phạm vi cần thiết để hoàn tất và đối soát giao dịch.',
        'NovaFrame không được bán dữ liệu cá nhân hoặc sử dụng dữ liệu cho mục đích quảng cáo không được thông báo nếu chưa có căn cứ xử lý phù hợp.',
      ],
    },
    {
      id: 'luu-tru',
      title: '6. Lưu giữ dữ liệu',
      paragraphs: [
        'Cấu trúc hiện tại lưu dữ liệu tài khoản, nội dung, tương tác, tin nhắn và giao dịch trong cơ sở dữ liệu; hình ảnh được lưu trong kho lưu trữ công khai hoặc riêng tư tùy loại.',
        'Không đủ dữ liệu để xác minh thời hạn lưu giữ cụ thể, lịch xóa bản sao lưu hoặc thời gian xóa ảnh tham chiếu tạm thời. Các thời hạn này phải được xác định theo mục đích xử lý, nghĩa vụ giao dịch và quy định áp dụng trước khi phát hành chính thức.',
      ],
    },
    {
      id: 'bao-mat',
      title: '7. Biện pháp bảo vệ',
      paragraphs: [
        'NovaFrame sử dụng xác thực bằng access token, kiểm tra quyền ở API, kho riêng cho ảnh gốc, giới hạn loại và kích thước tệp, xác minh mã ngân hàng, mã chống gửi lặp cho đặt giá và nhật ký cho các thao tác nhạy cảm.',
        'Không có biện pháp kỹ thuật nào loại bỏ hoàn toàn rủi ro. Người dùng không nên đăng mật khẩu, mã xác thực, giấy tờ định danh hoặc thông tin tài chính ngoài các trường được thiết kế riêng cho giao dịch.',
      ],
    },
    {
      id: 'quyen-cua-ban',
      title: '8. Quyền và lựa chọn của bạn',
      paragraphs: [
        'Bạn có thể chỉnh sửa một số thông tin hồ sơ, thay đổi trạng thái riêng tư, quản lý bảng lưu, nội dung, tương tác, chặn và cài đặt nhận tiền thông qua các chức năng hiện có.',
        'Đối với yêu cầu xem, sửa, rút lại sự đồng ý, hạn chế, phản đối, xóa dữ liệu hoặc khiếu nại ngoài các chức năng hiện có, mã nguồn chưa cấu hình kênh liên hệ pháp lý. Không đủ dữ liệu để xác minh quy trình và thời hạn phản hồi; thông tin này phải được bổ sung trước khi vận hành chính thức.',
      ],
    },
    {
      id: 'tre-em',
      title: '9. Dữ liệu của trẻ em',
      paragraphs: [
        'Mã nguồn hiện tại chưa có luồng xác minh độ tuổi hoặc đồng ý của cha, mẹ/người giám hộ. Không đủ dữ liệu để xác minh NovaFrame được thiết kế cho nhóm tuổi nào.',
        'Trước khi cho phép trẻ em sử dụng dịch vụ, NovaFrame phải xác định độ tuổi áp dụng và triển khai cơ chế đồng ý, bảo vệ và xử lý dữ liệu phù hợp với quy định hiện hành.',
      ],
    },
    {
      id: 'thay-doi',
      title: '10. Thay đổi chính sách',
      paragraphs: [
        'Phiên bản mới và ngày cập nhật phải được công bố rõ ràng khi mục đích xử lý, nhóm dữ liệu, bên nhận dữ liệu hoặc quyền của người dùng thay đổi đáng kể. Trường hợp cần sự đồng ý mới, NovaFrame phải yêu cầu trước khi xử lý theo mục đích mới.',
      ],
    },
  ],
};

@Component({
  selector: 'app-legal-page',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, ThemeToggle],
  templateUrl: './legal-page.html',
  styleUrl: './legal-page.css',
})
export class LegalPage implements OnInit {
  private readonly route = inject(ActivatedRoute);

  readonly documentType = this.readDocumentType();
  readonly legalDocument = this.documentType === 'privacy' ? PRIVACY : TERMS;
  readonly updatedAt = '25/08/2026';

  ngOnInit(): void {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  }

  scrollToSection(sectionId: string): void {
    if (typeof document === 'undefined') return;

    const section = document.getElementById(sectionId);
    if (!section) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      'matchMedia' in window &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    section.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  }

  private readDocumentType(): LegalDocumentType {
    return this.route.snapshot.data['document'] === 'privacy' ? 'privacy' : 'terms';
  }
}
