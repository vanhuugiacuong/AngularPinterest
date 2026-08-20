import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { Navbar } from '../../components/navbar/navbar';
import { MembershipPlan, MembershipService } from '../../core/services/membership';
@Component({ selector: 'app-pricing', standalone: true, imports: [CommonModule, Navbar], templateUrl: './pricing.html', styleUrl: './pricing.css' })
export class Pricing implements OnInit {
  membership = inject(MembershipService); busy = signal<MembershipPlan | null>(null); message = signal('');
  async ngOnInit() { await this.membership.load(); }
  async choose(plan: MembershipPlan) { this.busy.set(plan); this.message.set(''); try { await this.membership.subscribe(plan); this.message.set(`Đã chuyển sang gói ${plan}.`); } catch (e) { this.message.set(e instanceof Error ? e.message : 'Không thể đăng ký gói.'); } finally { this.busy.set(null); } }
}
