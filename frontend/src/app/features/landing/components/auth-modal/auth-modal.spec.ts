import { ComponentFixture, TestBed } from '@angular/core/testing';
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

    await TestBed.configureTestingModule({ imports: [AuthModal] }).compileComponents();
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
});
