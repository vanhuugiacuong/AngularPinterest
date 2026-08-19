import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { PinService } from '../../core/services/pin';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, Navbar],
  templateUrl: './search.html',
  styleUrl: './search.css'
})
export class Search implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private pinService = inject(PinService);

  public query = signal<string>('');
  public results = signal<any[]>([]);
  public isLoading = signal<boolean>(true);

  ngOnInit() {
    this.route.queryParamMap.subscribe(params => {
      const q = params.get('q') || '';
      this.query.set(q);
      this.runSearch(q);
    });
  }

  async runSearch(q: string) {
    this.isLoading.set(true);
    try {
      const pins = await this.pinService.getPins(1, 60);
      const needle = q.trim().toLowerCase();
      const filtered = needle
        ? pins.filter(p =>
            p.title?.toLowerCase().includes(needle) ||
            p.user?.username?.toLowerCase().includes(needle)
          )
        : pins;
      this.results.set(filtered);
    } catch (error) {
      console.error('Error searching pins:', error);
      this.results.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  navigateToPin(pinId: string) {
    this.router.navigate(['/pin', pinId]);
  }
}
