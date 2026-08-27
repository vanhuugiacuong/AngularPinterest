import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LegalPage } from './legal-page';

describe('LegalPage table of contents', () => {
  let fixture: ComponentFixture<LegalPage>;

  beforeEach(async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
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

    await TestBed.configureTestingModule({
      imports: [LegalPage],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(LegalPage);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
  });

  it('scrolls to the selected section without using a navigation link', () => {
    const host = fixture.nativeElement as HTMLElement;
    const firstControl = host.querySelector<HTMLButtonElement>('.nf-legal__toc button');
    const firstSection = host.querySelector<HTMLElement>('.nf-legal__section');
    const scrollIntoView = vi.fn();

    expect(firstControl).not.toBeNull();
    expect(firstSection).not.toBeNull();
    Object.defineProperty(firstSection!, 'scrollIntoView', { value: scrollIntoView });

    firstControl!.click();

    expect(firstControl!.tagName).toBe('BUTTON');
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });
});
