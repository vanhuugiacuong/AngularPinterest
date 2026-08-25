import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NfLoader } from './loader';

describe('NfLoader', () => {
  let fixture: ComponentFixture<NfLoader> | undefined;

  beforeEach(async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
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
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    await TestBed.configureTestingModule({ imports: [NfLoader] }).compileComponents();
    fixture = TestBed.createComponent(NfLoader);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture?.destroy();
    vi.restoreAllMocks();
  });

  it('renders the five-lane desktop image stream without legacy progress UI', () => {
    const root = fixture!.nativeElement as HTMLElement;

    expect(root.querySelectorAll('.nf-loader__strip').length).toBe(5);
    expect(root.querySelector('.nf-loader__logo')).toBeNull();
    expect(root.querySelector('.nf-loader__count')).toBeNull();
    expect(root.querySelector('.nf-loader__rail')).toBeNull();
    expect(root.textContent).not.toContain('%');
  });

  it('keeps decorative images silent and exposes one loader status', () => {
    const root = fixture!.nativeElement as HTMLElement;
    const status = root.querySelector<HTMLElement>('[role="status"]');
    const images = Array.from(root.querySelectorAll<HTMLImageElement>('img'));

    expect(status?.getAttribute('aria-label')).toBe('Đang chuẩn bị không gian khám phá NovaFrame');
    expect(images.length).toBeGreaterThan(0);
    expect(
      images.every((image) => image.alt === '' && image.getAttribute('aria-hidden') === 'true'),
    ).toBe(true);
  });

  it('uses the real hero selector contract for the shared transition', () => {
    const stage = document.createElement('div');
    stage.className = 'nf-ring-stage';
    const frame = document.createElement('span');
    frame.className = 'nf-ring__frame';
    stage.appendChild(frame);
    document.body.appendChild(stage);

    const getHeroElements = (
      fixture!.componentInstance as unknown as {
        getHeroElements: () => { stage: HTMLElement | null; frames: HTMLElement[] };
      }
    ).getHeroElements.bind(fixture!.componentInstance);
    const hero = getHeroElements();

    expect(hero.stage).toBe(stage);
    expect(hero.frames).toContain(frame);
    stage.remove();
  });

  it('reduces the stream from five to three and two lanes at responsive breakpoints', () => {
    const selectResponsiveStrips = (
      fixture!.componentInstance as unknown as { selectResponsiveStrips: () => unknown[] }
    ).selectResponsiveStrips.bind(fixture!.componentInstance);

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 });
    expect(selectResponsiveStrips().length).toBe(3);

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    expect(selectResponsiveStrips().length).toBe(2);
  });
});
