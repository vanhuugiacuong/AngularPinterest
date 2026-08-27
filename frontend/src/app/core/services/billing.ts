import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase';
import { API_BASE_URL } from '../api-base';

/**
 * Lớp thương mại (Pro + Credit) — theo đặc tả DAC-TA-TINH-NANG-THUONG-MAI.md.
 *
 * ƯU TIÊN GỌI BACKEND THẬT (module NestJS `billing`, prefix /api/billing):
 *   - refreshMe()            -> GET  /api/billing/me
 *   - startSubscribe()       -> POST /api/billing/subscribe        (trả ref + qrUrl)
 *   - startBuyCredits()      -> POST /api/billing/credits/purchase
 *   - checkPaymentStatus()   -> GET  /api/billing/payments/:ref/status  (webhook SePay cập nhật PAID)
 * Nếu backend CHƯA chạy (vd đang xem preview thuần frontend), tự động fallback về
 * mô phỏng localStorage để UI vẫn bấm-chạy được. Trạng thái `online()` cho biết đang
 * dùng backend thật hay bản mô phỏng.
 *
 * Chợ ảnh Premium (markPremium/purchasePin/hasEntitlement) hiện vẫn dùng registry
 * localStorage — phần này cần backend pins (cột isPremium/priceCredits) + private
 * bucket (§9) nên để tách riêng.
 */

export type PlanCode = 'MONTHLY' | 'YEARLY';
export type PackCode = 'S' | 'M' | 'L' | 'XL';

export type CreditTxnType =
  | 'PURCHASE'
  | 'MONTHLY_GRANT'
  | 'SPEND_DOWNLOAD'
  | 'EARN_SALE'
  | 'REFUND';

export interface CreditTxn {
  id: string;
  type: CreditTxnType;
  amount: number; // + cộng, - trừ
  balanceAfter: number;
  note: string;
  createdAt: string;
}

export interface Plan {
  code: PlanCode;
  name: string;
  priceVnd: number;
  months: number;
  grantCredits: number;
  badge?: string;
}

export interface CreditPack {
  code: PackCode;
  credits: number;
  priceVnd: number;
  popular?: boolean;
}

/** Đơn thanh toán đang chờ — cất lại để trang QR tự dò và "hoàn tất". */
interface PendingPayment {
  purpose: 'PRO_SUB' | 'CREDIT_PACK';
  planCode?: PlanCode;
  packCode?: PackCode;
  amountVnd: number;
  credits: number;
  txnRef: string;
  memo: string; // nội dung chuyển khoản định danh (để đối soát tự động)
  createdAtMs: number;
  qrUrl?: string; // URL QR do backend trả (nếu online)
  source: 'api' | 'local';
}

export type PaymentStatus = 'PENDING' | 'PAID' | 'EXPIRED';

/**
 * Thông tin tài khoản nhận tiền để sinh VietQR.
 * TODO: thay bằng tài khoản thật của bạn (bin theo chuẩn Napas, xem danh sách ở vietqr.io).
 * Mặc định để MB Bank (bin 970422) làm ví dụ.
 */
export const BANK = {
  bin: '970418', // BIDV (mã Napas)
  accountNo: '96247LIEM', // VA của SePay (tiền vào VA thì SePay mới bắt được)
  accountName: 'NGUYEN THANH LIEM',
  shortName: 'BIDV',
};

/** Đơn QR hết hạn sau 10 phút. */
export const QR_EXPIRE_MS = 10 * 60 * 1000;

interface BillingState {
  isPro: boolean;
  /** Đang dùng gói NĂM — quyền lợi riêng + huy hiệu chrome. */
  isYearly: boolean;
  proExpiresAt: string | null;
  spendable: number; // credit dùng để tải (grant + mua)
  earnings: number; // credit thu nhập từ bán ảnh
  transactions: CreditTxn[];
  entitlements: string[]; // pinId đã mua quyền tải
}

// ── Cấu hình (Phụ lục A đặc tả) — chỉnh ở đây, không cần sửa UI ────────────────
export const PLANS: Plan[] = [
  { code: 'MONTHLY', name: 'Pro tháng', priceVnd: 79000, months: 1, grantCredits: 300 },
  // Đồng bộ với backend billing.config.ts — gói năm tặng trọn 12 kỳ credit
  // (12 × 300) cộng 400 thưởng, vì credit chỉ cấp MỘT LẦN lúc thanh toán.
  { code: 'YEARLY', name: 'Pro năm', priceVnd: 690000, months: 12, grantCredits: 4000, badge: 'Tiết kiệm 27%' },
];

export const CREDIT_PACKS: CreditPack[] = [
  { code: 'S', credits: 100, priceVnd: 20000 },
  { code: 'M', credits: 300, priceVnd: 55000, popular: true },
  { code: 'L', credits: 700, priceVnd: 120000 },
  { code: 'XL', credits: 1500, priceVnd: 240000 },
];

const STORAGE_KEY = 'pinhub_billing_v1';
const PENDING_KEY = 'pinhub_billing_pending_v1';
const PREMIUM_KEY = 'pinhub_premium_pins_v1';

export const PREMIUM_PRICE_MIN = 10;
export const PREMIUM_PRICE_MAX = 500;

function fmtVnd(v: number): string {
  return new Intl.NumberFormat('vi-VN').format(v) + '₫';
}

@Injectable({ providedIn: 'root' })
export class BillingService {
  readonly plans = PLANS;
  readonly creditPacks = CREDIT_PACKS;

  private state = signal<BillingState>(this.load());

  // Signals công khai cho UI
  readonly isPro = computed(() => {
    const s = this.state();
    if (!s.isPro || !s.proExpiresAt) return false;
    return new Date(s.proExpiresAt).getTime() > Date.now();
  });
  /** Đang là Pro NĂM còn hạn — dùng cho huy hiệu chrome và quyền lợi riêng. */
  readonly isYearly = computed(() => this.isPro() && this.state().isYearly);
  readonly proExpiresAt = computed(() => this.state().proExpiresAt);
  readonly spendable = computed(() => this.state().spendable);
  readonly earnings = computed(() => this.state().earnings);
  readonly transactions = computed(() => this.state().transactions);

  formatVnd = fmtVnd;

  private supa = inject(SupabaseService);
  private api = `${API_BASE_URL}/api/billing`;
  /** true = đang dùng backend thật; false = bản mô phỏng localStorage. */
  readonly online = signal<boolean>(false);

  private async token(): Promise<string | null> {
    try {
      return await this.supa.getSessionToken();
    } catch {
      return null;
    }
  }

  /**
   * Gửi báo cáo sự cố chuyển khoản để admin xử lý thủ công.
   * Không tự cộng tiền — chỉ tạo phiếu chờ xem xét (xem billing.service.ts).
   */
  async reportPayment(ref: string, reason: string, note?: string): Promise<boolean> {
    const token = await this.token();
    if (!token) return false;
    try {
      const res = await fetch(`${this.api}/payments/${ref}/report`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, note }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Đồng bộ trạng thái từ backend (nếu có) ───────────────────────────────────
  /** Kéo trạng thái Pro + số dư ví từ server. Thất bại thì giữ nguyên state cục bộ. */
  async refreshMe(): Promise<void> {
    const token = await this.token();
    if (!token) return;
    try {
      const res = await fetch(`${this.api}/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const me = await res.json();
      this.online.set(true);
      this.state.update((s) => ({
        ...s,
        isPro: !!me.isPro,
        isYearly: !!me.isYearly,
        proExpiresAt: me.proExpiresAt ?? null,
        spendable: me.spendable ?? s.spendable,
        earnings: me.earnings ?? s.earnings,
      }));
      this.persist();
      await this.loadTransactions();
    } catch {
      this.online.set(false);
    }
  }

  private async loadTransactions(): Promise<void> {
    const token = await this.token();
    if (!token) return;
    try {
      const res = await fetch(`${this.api}/transactions`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const list = await res.json();
      this.state.update((s) => ({
        ...s,
        transactions: list.map((t: any) => ({
          id: t.id,
          type: t.type,
          amount: t.amount,
          balanceAfter: t.balanceAfter,
          note: t.note ?? '',
          createdAt: t.createdAt,
        })),
      }));
      this.persist();
    } catch {
      // giữ nguyên lịch sử cục bộ
    }
  }

  // ── Mua Pro / mua credit ────────────────────────────────────────────────────
  /** POST /api/billing/subscribe (fallback: mô phỏng cục bộ). Trả URL trang QR. */
  async startSubscribe(code: PlanCode): Promise<string> {
    const plan = PLANS.find((p) => p.code === code)!;
    const server = await this.createServerPayment('subscribe', { plan: code });
    if (server) {
      this.savePending(this.toPending('PRO_SUB', plan.priceVnd, plan.grantCredits, server, { planCode: code }));
      return `/billing/result?ref=${server.ref}`;
    }
    // Fallback mô phỏng
    const ref = this.randomRef();
    this.savePending({
      purpose: 'PRO_SUB', planCode: code, amountVnd: plan.priceVnd, credits: plan.grantCredits,
      txnRef: ref, memo: this.buildMemo(ref), createdAtMs: Date.now(), source: 'local',
    });
    return `/billing/result?ref=${ref}`;
  }

  /** POST /api/billing/credits/purchase (fallback: mô phỏng cục bộ). */
  async startBuyCredits(code: PackCode): Promise<string> {
    const pack = CREDIT_PACKS.find((p) => p.code === code)!;
    const server = await this.createServerPayment('credits/purchase', { packCode: code });
    if (server) {
      this.savePending(this.toPending('CREDIT_PACK', pack.priceVnd, pack.credits, server, { packCode: code }));
      return `/billing/result?ref=${server.ref}`;
    }
    const ref = this.randomRef();
    this.savePending({
      purpose: 'CREDIT_PACK', packCode: code, amountVnd: pack.priceVnd, credits: pack.credits,
      txnRef: ref, memo: this.buildMemo(ref), createdAtMs: Date.now(), source: 'local',
    });
    return `/billing/result?ref=${ref}`;
  }

  private async createServerPayment(path: string, body: any): Promise<any | null> {
    const token = await this.token();
    if (!token) return null;
    try {
      const res = await fetch(`${this.api}/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      this.online.set(true);
      return await res.json(); // { ref, memo, amountVnd, qrUrl, ... }
    } catch {
      return null;
    }
  }

  private toPending(
    purpose: 'PRO_SUB' | 'CREDIT_PACK',
    amountVnd: number,
    credits: number,
    server: any,
    extra: { planCode?: PlanCode; packCode?: PackCode },
  ): PendingPayment {
    return {
      purpose,
      amountVnd,
      credits,
      txnRef: server.ref,
      memo: server.memo,
      createdAtMs: Date.now(),
      qrUrl: server.qrUrl,
      source: 'api',
      ...extra,
    };
  }

  peekPending(): PendingPayment | null {
    return this.loadPending();
  }

  readonly bank = BANK;

  /** Nội dung chuyển khoản định danh — chỉ chữ/số để mọi app ngân hàng chấp nhận. */
  private buildMemo(ref: string): string {
    return ('PINHUB' + ref).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /** URL ảnh VietQR (quét được bằng app ngân hàng). Đã nhúng số tiền + nội dung CK. */
  qrImageUrl(p: PendingPayment): string {
    if (p.qrUrl) return p.qrUrl; // QR do backend cấp
    const params = new URLSearchParams({
      amount: String(p.amountVnd),
      addInfo: p.memo,
      accountName: BANK.accountName,
    });
    return `https://img.vietqr.io/image/${BANK.bin}-${BANK.accountNo}-compact2.png?${params.toString()}`;
  }

  /**
   * Dò trạng thái thanh toán (đối soát tự động).
   *
   * BẢN THẬT (source='api'): GET /api/billing/payments/:ref/status — backend được webhook
   * SePay/PayOS cập nhật PAID khi có tiền vào đúng nội dung CK. Khi PAID thì refreshMe().
   * BẢN MÔ PHỎNG (source='local'): tự coi là PAID sau AUTO_CONFIRM_MS.
   */
  async checkPaymentStatus(ref: string): Promise<PaymentStatus> {
    const p = this.loadPending();
    if (!p || p.txnRef !== ref) return 'EXPIRED';

    if (p.source === 'api') {
      const token = await this.token();
      if (token) {
        try {
          const res = await fetch(`${this.api}/payments/${ref}/status`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const { status } = await res.json();
            if (status === 'PAID') {
              this.clearPending();
              await this.refreshMe();
              return 'PAID';
            }
            if (status === 'EXPIRED' || status === 'FAILED') {
              this.clearPending();
              return 'EXPIRED';
            }
            return 'PENDING';
          }
        } catch {
          // rớt mạng — coi như vẫn đang chờ
        }
      }
      return 'PENDING';
    }

    // Chế độ demo (backend chưa chạy): KHÔNG tự xác nhận nữa — để tránh hiểu nhầm là
    // đã có tiền thật. Chỉ hết hạn theo thời gian; muốn "thành công" phải tự bấm
    // nút "Tôi đã chuyển khoản" (confirmNow) — đúng nghĩa là thao tác test thủ công.
    if (Date.now() - p.createdAtMs > QR_EXPIRE_MS) {
      this.clearPending();
      return 'EXPIRED';
    }
    return 'PENDING';
  }

  /**
   * Nút "Tôi đã chuyển khoản". BẢN THẬT: chỉ dò lại trạng thái ngay (không tự cộng tiền —
   * chỉ webhook mới cộng). BẢN MÔ PHỎNG: cộng luôn để rút ngắn demo.
   */
  async confirmNow(ref: string): Promise<boolean> {
    const p = this.loadPending();
    if (!p || p.txnRef !== ref) return false;
    if (p.source === 'api') {
      return (await this.checkPaymentStatus(ref)) === 'PAID';
    }
    this.completePending(ref, true);
    return true;
  }

  /**
   * Hoàn tất đơn đang chờ (giả lập VNPay IPN cộng tiền — §8.1 đặc tả).
   * Idempotent theo txnRef: gọi lại cùng ref sẽ không cộng trùng.
   */
  completePending(ref: string, success: boolean): PendingPayment | null {
    const pending = this.loadPending();
    if (!pending || pending.txnRef !== ref) return pending;
    this.clearPending();
    if (!success) return pending;

    if (pending.purpose === 'PRO_SUB' && pending.planCode) {
      this.activatePro(pending.planCode, pending.credits);
    } else if (pending.purpose === 'CREDIT_PACK') {
      this.addCredits(pending.credits, 'PURCHASE', `Mua ${pending.credits} credit`);
    }
    return pending;
  }

  private activatePro(code: PlanCode, grant: number) {
    const plan = PLANS.find((p) => p.code === code)!;
    const now = Date.now();
    const base = this.isPro() && this.state().proExpiresAt
      ? new Date(this.state().proExpiresAt as string).getTime()
      : now;
    const expires = new Date(base + plan.months * 30 * 24 * 3600 * 1000);
    this.state.update((s) => ({ ...s, isPro: true, proExpiresAt: expires.toISOString() }));
    this.addCredits(grant, 'MONTHLY_GRANT', `Credit tặng kèm ${plan.name}`);
    this.persist();
  }

  // ── Mua & tải ảnh Premium ──────────────────────────────────────────────────
  hasEntitlement(pinId: string): boolean {
    return this.state().entitlements.includes(pinId);
  }

  /**
   * Trả credit để mua quyền tải một pin Premium (§FR-11). Trả về true nếu thành công.
   * TODO(api): POST /api/pins/:id/purchase (server trừ credit + chia doanh thu + tạo entitlement).
   */
  purchasePin(pinId: string, priceCredits: number): boolean {
    if (this.hasEntitlement(pinId)) return true; // idempotent
    if (this.state().spendable < priceCredits) return false;
    this.spend(priceCredits, `Tải HD ảnh Premium`, pinId);
    this.state.update((s) => ({ ...s, entitlements: [...s.entitlements, pinId] }));
    this.persist();
    return true;
  }

  // ── Ảnh Premium qua API thật ────────────────────────────────────────────────
  /** GET /api/billing/pins/:id/access — trạng thái quyền tải. null nếu backend chưa chạy. */
  async getPinAccess(pinId: string): Promise<
    { isPremium: boolean; priceCredits: number | null; owned: boolean; purchased: boolean; canDownload: boolean } | null
  > {
    const token = await this.token();
    if (!token) return null;
    try {
      const res = await fetch(`${this.api}/pins/${pinId}/access`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      this.online.set(true);
      return await res.json();
    } catch {
      return null;
    }
  }

  /** POST /api/billing/pins/:id/purchase — trả credit mua quyền tải. */
  async purchasePinApi(pinId: string): Promise<{ ok: boolean; reason?: string }> {
    const token = await this.token();
    if (!token) return { ok: false, reason: 'no_token' };
    try {
      const res = await fetch(`${this.api}/pins/${pinId}/purchase`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        await this.refreshMe();
        return { ok: true };
      }
      const body = await res.json().catch(() => ({}));
      return { ok: false, reason: body?.message || 'error' };
    } catch {
      return { ok: false, reason: 'network' };
    }
  }

  // ── Ảnh Premium (registry client-side — FALLBACK khi backend chưa chạy) ──────
  private premium = signal<Record<string, number>>(this.loadPremium());

  /** Đánh dấu một pin là Premium với giá credit (dùng ngay sau khi tạo pin). */
  markPremium(pinId: string, priceCredits: number) {
    const price = Math.max(PREMIUM_PRICE_MIN, Math.min(PREMIUM_PRICE_MAX, Math.round(priceCredits)));
    this.premium.update((m) => ({ ...m, [pinId]: price }));
    this.persistPremium();
  }

  isPremium(pinId: string): boolean {
    return pinId in this.premium();
  }

  premiumPrice(pinId: string): number | null {
    return this.premium()[pinId] ?? null;
  }

  private loadPremium(): Record<string, number> {
    try {
      const raw = localStorage.getItem(PREMIUM_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private persistPremium() {
    try {
      localStorage.setItem(PREMIUM_KEY, JSON.stringify(this.premium()));
    } catch {}
  }

  // ── Nội bộ ví ──────────────────────────────────────────────────────────────
  private addCredits(amount: number, type: CreditTxnType, note: string) {
    this.state.update((s) => {
      const balanceAfter = s.spendable + amount;
      return {
        ...s,
        spendable: balanceAfter,
        transactions: [this.txn(type, amount, balanceAfter, note), ...s.transactions].slice(0, 100),
      };
    });
    this.persist();
  }

  private spend(amount: number, note: string, pinId?: string) {
    this.state.update((s) => {
      const balanceAfter = s.spendable - amount;
      return {
        ...s,
        spendable: balanceAfter,
        transactions: [this.txn('SPEND_DOWNLOAD', -amount, balanceAfter, note + (pinId ? ` · #${pinId.slice(0, 6)}` : '')), ...s.transactions].slice(0, 100),
      };
    });
  }

  private txn(type: CreditTxnType, amount: number, balanceAfter: number, note: string): CreditTxn {
    return {
      id: this.randomRef(),
      type,
      amount,
      balanceAfter,
      note,
      createdAt: new Date().toISOString(),
    };
  }

  private randomRef(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ── Persistence ─────────────────────────────────────────────────────────────
  private load(): BillingState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // localStorage không dùng được (private mode) — dùng mặc định.
    }
    return { isPro: false, isYearly: false, proExpiresAt: null, spendable: 0, earnings: 0, transactions: [], entitlements: [] };
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state()));
    } catch {
      // bỏ qua nếu không lưu được
    }
  }

  private savePending(p: PendingPayment) {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    } catch {}
  }

  private loadPending(): PendingPayment | null {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private clearPending() {
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {}
  }
}
