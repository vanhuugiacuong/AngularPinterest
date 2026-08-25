import { ChangeDetectionStrategy, Component, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'app-landing-cta-button',
  standalone: true,
  templateUrl: './landing-cta-button.html',
  styleUrl: './landing-cta-button.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingCtaButton {
  @Output() readonly activated = new EventEmitter<void>();

  readonly label = 'Bắt đầu khám phá';
  readonly characters = Array.from(this.label);
}
