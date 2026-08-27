import { ElementRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SupabaseService } from '../../core/services/supabase';
import { Landing } from './landing';

describe('Landing explore orbit', () => {
  function createLanding() {
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: {} },
        {
          provide: ElementRef,
          useValue: new ElementRef(document.createElement('app-landing')),
        },
      ],
    });

    return TestBed.runInInjectionContext(() => new Landing());
  }

  it('wraps the six local artworks with one edge clone on each side', () => {
    const landing = createLanding();

    expect(landing.artworks).toHaveLength(6);
    expect(landing.orbitArtworks).toHaveLength(8);
    expect(landing.orbitArtworks[0]).toBe(landing.artworks[5]);
    expect(landing.orbitArtworks[7]).toBe(landing.artworks[0]);
    expect(landing.artworks.every((art) => art.src.startsWith('/landing/work-'))).toBe(true);
  });
});
