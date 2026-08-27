import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { Icon } from '../../shared/icon/icon';
import { SupabaseService } from '../../core/services/supabase';
import { BillingService, PlanCode } from '../../core/services/billing';

interface Benefit {
  icon: string;
  title: string;
  desc: string;
  free: string;
  /** Cột "Pro tháng" trong bảng so sánh. */
  pro: string;
  /** Cột "Pro năm" — bỏ trống nghĩa là giống hệt gói tháng. */
  yearly?: string;
  /** Quyền lợi "mũi nhọn" — hiển thị to/nổi hơn hẳn phần còn lại. */
  highlight?: boolean;
  /** Nhãn ngắn gắn cạnh tiêu đề khi highlight (vd "ĐỘC QUYỀN PRO"). */
  tag?: string;
}

@Component({
  selector: 'app-pro',
  standalone: true,
  imports: [CommonModule, Navbar, Icon],
  templateUrl: './pro.html',
  styleUrl: './pro.css',
})
export class Pro implements OnInit {
  public billing = inject(BillingService);
  private supabase = inject(SupabaseService);
  private router = inject(Router);

  get holderName(): string {
    const u = this.supabase.dbUser();
    const meta = this.supabase.user()?.user_metadata;
    const name = u?.username || meta?.['full_name'] || meta?.['name'] || 'PINHUB MEMBER';
    return String(name).toUpperCase();
  }

  public selected = signal<PlanCode>('YEARLY');
  public plans = this.billing.plans;

  public monthlyEquivalent = computed(() => {
    const yearly = this.plans.find((p) => p.code === 'YEARLY')!;
    return Math.round(yearly.priceVnd / 12);
  });

  public benefits: Benefit[] = [
    // Quyền lợi kiếm tiền — chỉ Pro mới bật được (backend chặn ở
    // pins.service.ts normalizePremium), nên để đầu danh sách.
    { icon: 'money', title: 'Bán ảnh Premium', desc: 'Đặt giá credit cho ảnh của bạn, người khác trả credit để tải bản HD.', free: 'Không bán được', pro: 'Nhận 70%/lượt', yearly: 'Nhận 80%/lượt', highlight: true, tag: 'ĐỘC QUYỀN PRO' },
    // Cùng nhóm "bán ảnh" với dòng trên nên dùng chung icon $, không dùng icon xu
    { icon: 'money', title: 'Giá bán tối đa mỗi ảnh', desc: 'Trần giá bạn được phép đặt cho một ảnh Premium.', free: '—', pro: '500 credit', yearly: '1.000 credit' },
    // Credit cấp MỘT LẦN khi thanh toán, không phải hằng tháng — mô tả cũ ghi
    // "300 credit mỗi kỳ" là sai so với backend (xem markPaid trong billing.service).
    { icon: 'coin', title: 'Credit tặng khi đăng ký', desc: 'Cấp một lần ngay khi thanh toán, dùng để tải ảnh Premium của người khác.', free: '0', pro: '300', yearly: '4.000' },
    { icon: 'spark', title: 'Tạo ảnh AI không giới hạn', desc: 'Không còn giới hạn lượt/ngày, có model cao cấp & không phải xếp hàng.', free: '10 lượt/ngày', pro: 'Không giới hạn' },
    { icon: 'hd', title: 'Tải HD, không watermark', desc: 'Tải bản gốc sắc nét cho ảnh của bạn và mọi ảnh miễn phí.', free: 'Bản thường', pro: 'HD sạch' },
    { icon: 'lock', title: 'Board bí mật', desc: 'Tạo board riêng tư không giới hạn số lượng.', free: 'Tối đa 3', pro: 'Không giới hạn' },
    { icon: 'crown', title: 'Huy hiệu thành viên', desc: 'Huy hiệu trên hồ sơ. Gói năm dùng huy hiệu chrome ánh cầu vồng, hiếm hơn hẳn.', free: '—', pro: 'Hồng', yearly: 'Chrome' },
  ];

  selectPlan(code: PlanCode) {
    this.selected.set(code);
  }

  get selectedPlan() {
    return this.plans.find((p) => p.code === this.selected())!;
  }

  public isStarting = signal(false);

  async ngOnInit() {
    await this.billing.refreshMe();
  }

  async subscribe() {
    await this.start(this.selected());
  }

  /** Gia hạn (khi đã là Pro) — cộng dồn thời hạn. */
  async renew(code: PlanCode) {
    await this.start(code);
  }

  private async start(code: PlanCode) {
    this.isStarting.set(true);
    try {
      const url = await this.billing.startSubscribe(code);
      this.router.navigateByUrl(url);
    } finally {
      this.isStarting.set(false);
    }
  }

  goWallet() {
    this.router.navigate(['/wallet']);
  }
}
