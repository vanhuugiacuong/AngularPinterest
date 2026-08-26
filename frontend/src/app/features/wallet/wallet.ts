import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { BillingService, PackCode, CreditTxnType } from '../../core/services/billing';

@Component({
  selector: 'app-wallet',
  standalone: true,
  imports: [CommonModule, Navbar],
  templateUrl: './wallet.html',
  styleUrl: './wallet.css',
})
export class Wallet implements OnInit {
  public billing = inject(BillingService);
  private router = inject(Router);

  public packs = this.billing.creditPacks;
  public buyingCode = signal<PackCode | null>(null);

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

  goPro() {
    this.router.navigate(['/pro']);
  }

  txnIcon(type: CreditTxnType): string {
    switch (type) {
      case 'PURCHASE': return 'add_card';
      case 'MONTHLY_GRANT': return 'redeem';
      case 'SPEND_DOWNLOAD': return 'download';
      case 'EARN_SALE': return 'payments';
      case 'REFUND': return 'undo';
      default: return 'toll';
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
