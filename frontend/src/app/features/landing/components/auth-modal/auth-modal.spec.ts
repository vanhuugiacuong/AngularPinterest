import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthModal } from './auth-modal';

describe('AuthModal scroll locking', () => {
  let fixture: ComponentFixture<AuthModal> | undefined;
  let originalOverflow: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'auto';

    // The acknowledgement is stored in localStorage, which outlives a fixture —
    // without clearing it, a test that acknowledges would silently decide which
    // step every later test opens on, and the suite would pass or fail on
    // ordering rather than on behaviour.
    try {
      localStorage.removeItem('novaframe:content-warning-ack');
    } catch {
      // Không truy cập được localStorage thì component đã tự coi là chưa xác nhận.
    }

    await TestBed.configureTestingModule({
      imports: [AuthModal],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(AuthModal);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture?.destroy();
    document.body.style.overflow = originalOverflow;
    vi.useRealTimers();
  });

  it('releases its own body lock before emitting close', () => {
    const overflowAtClose = vi.fn((_overflow: string) => undefined);
    fixture!.componentInstance.closeModal.subscribe(() => {
      overflowAtClose(document.body.style.overflow);
    });

    expect(document.body.style.overflow).toBe('hidden');
    fixture!.componentInstance.requestClose();

    expect(overflowAtClose).toHaveBeenCalledWith('auto');
  });

  it('does not overwrite the loader lock when its exit timer finishes', () => {
    fixture!.componentInstance.closeModal.subscribe(() => {
      fixture!.componentRef.setInput('open', false);
      fixture!.detectChanges();
      document.body.style.overflow = 'hidden';
    });

    fixture!.componentInstance.requestClose();
    vi.advanceTimersByTime(500);

    expect(document.body.style.overflow).toBe('hidden');
  });

  it('opens on the content notice for a first-time visitor, then advances to sign-in', () => {
    const host = fixture!.nativeElement as HTMLElement;

    // No acknowledgement stored, so the notice comes first — the whole point is
    // that it cannot be skipped past on the way to creating an account.
    expect(fixture!.componentInstance.step()).toBe('warning');
    expect(host.querySelector('.nf-auth__notice')).not.toBeNull();
    expect(host.querySelector('.nf-auth__gicon')).toBeNull();

    fixture!.componentInstance.acknowledgeWarning();
    fixture!.detectChanges();

    expect(fixture!.componentInstance.step()).toBe('signin');
    expect(host.querySelector('.nf-auth__notice')).toBeNull();
  });

  it('routes each legal link to its matching public page', () => {
    // Asserts the SIGN-IN step's fine print, so the notice step has to be
    // cleared first — it carries only the terms link.
    fixture!.componentInstance.acknowledgeWarning();
    fixture!.detectChanges();

    const host = fixture!.nativeElement as HTMLElement;
    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('.nf-auth__fine a'));

    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/terms', '/privacy']);
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'Điều khoản Dịch vụ',
      'Chính sách Bảo mật',
    ]);
  });
});
