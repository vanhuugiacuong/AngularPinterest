import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LandingCtaButton } from './landing-cta-button';

describe('LandingCtaButton', () => {
  let fixture: ComponentFixture<LandingCtaButton>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingCtaButton],
    }).compileComponents();

    fixture = TestBed.createComponent(LandingCtaButton);
    fixture.detectChanges();
  });

  it('uses the requested Vietnamese call-to-action label', () => {
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Bắt đầu khám phá');
  });

  it('emits activated when clicked', () => {
    const emitted = vi.fn();
    fixture.componentInstance.activated.subscribe(emitted);

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.click();

    expect(emitted).toHaveBeenCalledOnce();
  });

});
