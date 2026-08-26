import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { BillingService, PlanCode } from '../../core/services/billing';

interface Benefit {
  icon: string;
  title: string;
  desc: string;
  free: string;
  pro: string;
}

@Component({
  selector: 'app-pro',
  standalone: true,
  imports: [CommonModule, Navbar],
  templateUrl: './pro.html',
  styleUrl: './pro.css',
})
export class Pro implements OnInit {
  public billing = inject(BillingService);
  private router = inject(Router);

  public selected = signal<PlanCode>('YEARLY');
  public plans = this.billing.plans;

  public monthlyEquivalent = computed(() => {
    const yearly = this.plans.find((p) => p.code === 'YEARLY')!;
    return Math.round(yearly.priceVnd / 12);
  });

  public benefits: Benefit[] = [
    { icon: 'auto_awesome', title: 'Tạo ảnh AI không giới hạn', desc: 'Không còn giới hạn lượt/ngày, có model cao cấp & không phải xếp hàng.', free: '10 lượt/ngày', pro: 'Không giới hạn' },
    { icon: 'high_quality', title: 'Tải HD, không watermark', desc: 'Tải bản gốc sắc nét cho ảnh của bạn và mọi ảnh miễn phí.', free: 'Bản thường', pro: 'HD sạch' },
    { icon: 'toll', title: 'Credit tặng hàng tháng', desc: 'Nhận 300 credit mỗi kỳ để tải ảnh đẹp của người khác.', free: '0', pro: '300 / tháng' },
    { icon: 'lock', title: 'Board bí mật', desc: 'Tạo board riêng tư không giới hạn số lượng.', free: 'Tối đa 3', pro: 'Không giới hạn' },
    { icon: 'workspace_premium', title: 'Huy hiệu Pro', desc: 'Nổi bật trên hồ sơ với huy hiệu Pro và ưu tiên hiển thị.', free: '—', pro: 'Có' },
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
    this.isStarting.set(true);
    try {
      const url = await this.billing.startSubscribe(this.selected());
      this.router.navigateByUrl(url);
    } finally {
      this.isStarting.set(false);
    }
  }

  goWallet() {
    this.router.navigate(['/wallet']);
  }
}
