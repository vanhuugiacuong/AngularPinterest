import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UserAvatar } from './user-avatar';

describe('UserAvatar', () => {
  let fixture: ComponentFixture<UserAvatar>;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UserAvatar] }).compileComponents();
    fixture = TestBed.createComponent(UserAvatar);
    root = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('name', 'Nova Frame');
    fixture.componentRef.setInput('size', 64);
    fixture.detectChanges();
  });

  function outer(): HTMLElement {
    return root.querySelector('.uav-outer') as HTMLElement;
  }

  it('renders no membership frame for a FREE user', () => {
    fixture.componentRef.setInput('plan', 'FREE');
    fixture.detectChanges();

    expect(outer().classList.contains('uav-outer--plus')).toBe(false);
    expect(outer().classList.contains('uav-outer--pro')).toBe(false);
    expect(root.querySelector('.uav-ring')).toBeNull();
  });

  it('renders the Plus frame for a PLUS user', () => {
    fixture.componentRef.setInput('plan', 'PLUS');
    fixture.detectChanges();

    expect(outer().classList.contains('uav-outer--plus')).toBe(true);
    expect(root.querySelector('.uav-ring--primary')).not.toBeNull();
    expect(root.querySelector('.uav-ring--pro-outer')).toBeNull();
  });

  it('renders the Pro frame for a PRO user', () => {
    fixture.componentRef.setInput('plan', 'PRO');
    fixture.detectChanges();

    expect(outer().classList.contains('uav-outer--pro')).toBe(true);
    expect(root.querySelector('.uav-ring--primary')).not.toBeNull();
    expect(root.querySelector('.uav-ring--pro-outer')).not.toBeNull();
  });

  it('gives Plus and Pro visibly different frames — Pro adds a second ring layer Plus never has', () => {
    fixture.componentRef.setInput('plan', 'PLUS');
    fixture.detectChanges();
    const plusRingCount = root.querySelectorAll('.uav-ring').length;
    expect(outer().classList.contains('uav-outer--plus')).toBe(true);
    expect(outer().classList.contains('uav-outer--pro')).toBe(false);

    fixture.componentRef.setInput('plan', 'PRO');
    fixture.detectChanges();
    const proRingCount = root.querySelectorAll('.uav-ring').length;

    expect(plusRingCount).toBe(1);
    expect(proRingCount).toBe(2);
    expect(outer().classList.contains('uav-outer--pro')).toBe(true);
    expect(outer().classList.contains('uav-outer--plus')).toBe(false);
  });

  it('treats a null plan as no frame', () => {
    fixture.componentRef.setInput('plan', null);
    fixture.detectChanges();

    expect(outer().classList.contains('uav-outer--plus')).toBe(false);
    expect(outer().classList.contains('uav-outer--pro')).toBe(false);
    expect(root.querySelector('.uav-ring')).toBeNull();
  });

  it('treats an undefined plan as no frame', () => {
    fixture.componentRef.setInput('plan', undefined);
    fixture.detectChanges();

    expect(outer().classList.contains('uav-outer--plus')).toBe(false);
    expect(outer().classList.contains('uav-outer--pro')).toBe(false);
    expect(root.querySelector('.uav-ring')).toBeNull();
  });

  it('shows the real photo once it loads', () => {
    fixture.componentRef.setInput('src', 'https://cdn.example.com/a.jpg');
    fixture.detectChanges();

    const img = root.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    img.dispatchEvent(new Event('load'));
    fixture.detectChanges();

    expect(img.classList.contains('opacity-0')).toBe(false);
    expect(root.querySelector('[aria-hidden="true"].absolute.inset-0.flex')).toBeNull();
  });

  it('falls back to initials on image error while keeping the membership frame', () => {
    fixture.componentRef.setInput('src', 'https://cdn.example.com/broken.jpg');
    fixture.componentRef.setInput('plan', 'PRO');
    fixture.detectChanges();

    const img = root.querySelector('img') as HTMLImageElement;
    img.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(root.textContent).toContain('NF');
    expect(outer().classList.contains('uav-outer--pro')).toBe(true);
    expect(root.querySelector('.uav-ring--pro-outer')).not.toBeNull();
  });

  it('hides the text badge on small avatars even when the frame is active', () => {
    fixture.componentRef.setInput('size', 20);
    fixture.componentRef.setInput('plan', 'PRO');
    fixture.detectChanges();

    expect(root.querySelector('.uav-plan-badge')).toBeNull();
    expect(outer().classList.contains('uav-outer--pro')).toBe(true);
  });

  it('shows the text badge once the avatar is 40px or larger', () => {
    fixture.componentRef.setInput('size', 48);
    fixture.componentRef.setInput('plan', 'PLUS');
    fixture.detectChanges();

    const badge = root.querySelector('.uav-plan-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent?.trim()).toBe('PLUS');
    expect(badge?.getAttribute('aria-label')).toBe('Thành viên Plus');
  });

  it('can be turned off with showMembershipFrame = false', () => {
    fixture.componentRef.setInput('plan', 'PRO');
    fixture.componentRef.setInput('showMembershipFrame', false);
    fixture.detectChanges();

    expect(outer().classList.contains('uav-outer--pro')).toBe(false);
    expect(root.querySelector('.uav-ring')).toBeNull();
    expect(root.querySelector('.uav-plan-badge')).toBeNull();
  });

  it('updates the DOM immediately when plan changes from FREE to PLUS at runtime', () => {
    fixture.componentRef.setInput('plan', 'FREE');
    fixture.detectChanges();
    expect(root.querySelector('.uav-ring')).toBeNull();

    fixture.componentRef.setInput('plan', 'PLUS');
    fixture.detectChanges();

    expect(root.querySelector('.uav-ring--primary')).not.toBeNull();
    expect(outer().classList.contains('uav-outer--plus')).toBe(true);
  });

  it('updates the DOM immediately when plan changes from FREE to PRO at runtime', () => {
    fixture.componentRef.setInput('plan', 'FREE');
    fixture.detectChanges();
    expect(root.querySelector('.uav-ring')).toBeNull();

    fixture.componentRef.setInput('plan', 'PRO');
    fixture.detectChanges();

    expect(root.querySelectorAll('.uav-ring').length).toBe(2);
    expect(outer().classList.contains('uav-outer--pro')).toBe(true);
  });
});
