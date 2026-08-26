import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { Icon } from '../../shared/icon/icon';
import { SupabaseService } from '../../core/services/supabase';
import { BillingService, PackCode, CreditTxnType } from '../../core/services/billing';

@Component({
  selector: 'app-wallet',
  standalone: true,
  imports: [CommonModule, Navbar, Icon],
  templateUrl: './wallet.html',
  styleUrl: './wallet.css',
})
export class Wallet implements OnInit {
  public billing = inject(BillingService);
  private supabase = inject(SupabaseService);
  private router = inject(Router);

  public packs = this.billing.creditPacks;
  public buyingCode = signal<PackCode | null>(null);
  public flipped = signal(false);

  flip() {
    this.flipped.update((v) => !v);
  }

  get holderName(): string {
    const u = this.supabase.dbUser();
    const meta = this.supabase.user()?.user_metadata;
    const name = u?.username || meta?.['full_name'] || meta?.['name'] || 'PINHUB MEMBER';
    return String(name).toUpperCase();
  }

  async ngOnInit() {
    await this.billing.refreshMe();
  }

  async buy(code: PackCode) {
    this.buyingCode.set(code);
    try {
      const url = await this.billing.startBuyCredits(code);
      this.router.navigateByUrl(url);
    } finally {
      this.buyingCode.set(null);
    }
  }

  goPro() { this.router.navigate(['/pro']); }

  txnIcon(type: CreditTxnType): string {
    switch (type) {
      case 'PURCHASE': return 'wallet';
      case 'MONTHLY_GRANT': return 'spark';
      case 'SPEND_DOWNLOAD': return 'download';
      case 'EARN_SALE': return 'coin';
      case 'REFUND': return 'sync';
      default: return 'coin';
    }
  }

  txnLabel(type: CreditTxnType): string {
    switch (type) {
      case 'PURCHASE': return 'Nạp credit';
      case 'MONTHLY_GRANT': return 'Credit tặng';
      case 'SPEND_DOWNLOAD': return 'Tải ảnh Premium';
      case 'EARN_SALE': return 'Bán ảnh';
      case 'REFUND': return 'Hoàn credit';
      default: return 'Giao dịch';
    }
  }
}
