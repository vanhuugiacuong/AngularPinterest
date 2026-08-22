import { Component, inject, signal, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService } from '../../core/services/supabase';
import * as THREE from 'three';

interface CardMotion {
  baseX: number;
  baseY: number;
  baseZ: number;
  speed: number;
  phase: number;
  driftX: number;
  driftZ: number;
  spinSpeed: number;
}

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './landing.html',
  styleUrl: './landing.css'
})
export class Landing implements OnInit, AfterViewInit, OnDestroy {
  private supabaseService = inject(SupabaseService);
  private ngZone = inject(NgZone);

  public showLoginModal = signal<boolean>(false);
  public errorMsg = signal<string | null>(null);
  public isSceneLoading = signal<boolean>(true);

  @ViewChild('heroCanvas') heroCanvasRef!: ElementRef<HTMLCanvasElement>;

  // Drop the actual image files here (any format) with these exact names.
  private readonly IMAGE_URLS = [
    '/hero-cards/hero-01.jpg',
    '/hero-cards/hero-02.jpg',
    '/hero-cards/hero-03.jpg',
    '/hero-cards/hero-04.jpg',
    '/hero-cards/hero-05.jpg',
    '/hero-cards/hero-06.jpg',
    '/hero-cards/hero-07.jpg',
    '/hero-cards/hero-08.jpg',
    '/hero-cards/hero-09.png',
    '/hero-cards/hero-10.png',
  ];
  private readonly FALLBACK_COLORS = ['#3A2A30', '#2E2A33', '#302A3A', '#33363D', '#3D2E36'];
  private readonly CARD_COUNT = 70;

  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera!: THREE.PerspectiveCamera;
  private group = new THREE.Group();
  private cards: THREE.Mesh[] = [];
  private particles?: THREE.Points;
  private clock = new THREE.Clock();
  private animationFrameId?: number;
  private disposed = false;

  private targetX = 0;
  private targetY = 0;
  private curX = 0;
  private curY = 0;

  private onResize = () => this.resize();
  private onPointerMove = (e: PointerEvent) => {
    this.targetX = e.clientX / window.innerWidth - 0.5;
    this.targetY = e.clientY / window.innerHeight - 0.5;
  };

  ngOnInit() {
    // Check if there is an auth error in the URL (redirected back from failed Google OAuth)
    const searchParams = new URLSearchParams(window.location.search);
    let errorDescription = searchParams.get('error_description');

    if (!errorDescription && window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      errorDescription = hashParams.get('error_description');
    }

    if (errorDescription) {
      this.errorMsg.set(decodeURIComponent(errorDescription.replace(/\+/g, ' ')));
      this.showLoginModal.set(true); // Open the modal automatically to show the error
    }
  }

  ngAfterViewInit() {
    this.initScene();
  }

  ngOnDestroy() {
    this.disposed = true;
    if (this.animationFrameId !== undefined) {
      cancelAnimationFrame(this.animationFrameId);
    }
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointermove', this.onPointerMove);

    this.cards.forEach(mesh => {
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    });
    if (this.particles) {
      this.particles.geometry.dispose();
      (this.particles.material as THREE.Material).dispose();
    }
    this.renderer?.dispose();
  }

  private async initScene() {
    const canvas = this.heroCanvasRef.nativeElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene.fog = new THREE.FogExp2(0x0a0a0c, 0.032);
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 0, 16);

    window.addEventListener('resize', this.onResize);
    window.addEventListener('pointermove', this.onPointerMove);
    this.resize();

    const textures = await Promise.all(
      this.IMAGE_URLS.map((url, i) => this.loadCardTexture(url, this.FALLBACK_COLORS[i % this.FALLBACK_COLORS.length]))
    );
    if (this.disposed) return;

    this.buildScene(textures);
    this.isSceneLoading.set(false);

    // Only the 60fps render loop runs outside Angular's zone, to avoid triggering
    // a change-detection pass on every frame.
    this.ngZone.runOutsideAngular(() => this.animate());
  }

  private resize() {
    if (!this.renderer || !this.camera) return;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // ---------- load image into a rounded-rect, cover-fit canvas texture ----------
  private loadCardTexture(url: string, fallbackColor: string): Promise<THREE.CanvasTexture> {
    const roundRect = (ctx: CanvasRenderingContext2D, w: number, h: number, rad: number) => {
      ctx.beginPath();
      ctx.moveTo(rad, 0);
      ctx.arcTo(w, 0, w, h, rad);
      ctx.arcTo(w, h, 0, h, rad);
      ctx.arcTo(0, h, 0, 0, rad);
      ctx.arcTo(0, 0, w, 0, rad);
      ctx.closePath();
    };

    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        const s = 1024;
        const c = document.createElement('canvas');
        c.width = s;
        c.height = Math.round(s * 1.25);
        const ctx = c.getContext('2d')!;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        roundRect(ctx, c.width, c.height, 34 * (s / 512));
        ctx.clip();

        const cardRatio = c.width / c.height;
        const imgRatio = img.width / img.height;
        let dw: number, dh: number, dx: number, dy: number;
        if (imgRatio > cardRatio) {
          dh = c.height; dw = dh * imgRatio; dx = (c.width - dw) / 2; dy = 0;
        } else {
          dw = c.width; dh = dw / imgRatio; dx = 0; dy = (c.height - dh) / 2;
        }
        ctx.drawImage(img, dx, dy, dw, dh);

        resolve(new THREE.CanvasTexture(c));
      };

      img.onerror = () => {
        const s = 512;
        const c = document.createElement('canvas');
        c.width = s;
        c.height = Math.round(s * 1.25);
        const ctx = c.getContext('2d')!;
        roundRect(ctx, c.width, c.height, 34);
        ctx.fillStyle = fallbackColor;
        ctx.fill();
        resolve(new THREE.CanvasTexture(c));
      };

      img.src = url;
    });
  }

  // ---------- SCATTER: 3D grid + jitter so cards never clump together ----------
  private scatterPositions(count: number): { x: number; y: number; z: number }[] {
    const GX = 8, GY = 7, GZ = 5; // grid cells per axis
    const cellW = 3.2, cellH = 2.7, cellD = 4.0; // spacing between cells

    const cells: { x: number; y: number; z: number }[] = [];
    for (let x = 0; x < GX; x++) {
      for (let y = 0; y < GY; y++) {
        for (let z = 0; z < GZ; z++) {
          cells.push({ x, y, z });
        }
      }
    }

    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const picked = cells.slice(0, count);

    return picked.map(cell => {
      const jitterX = (Math.random() - 0.5) * cellW * 0.35;
      const jitterY = (Math.random() - 0.5) * cellH * 0.35;
      const jitterZ = (Math.random() - 0.5) * cellD * 0.5;
      return {
        x: (cell.x - (GX - 1) / 2) * cellW + jitterX,
        y: (cell.y - (GY - 1) / 2) * cellH + jitterY,
        z: (cell.z - (GZ - 1) / 2) * cellD + jitterZ - 3,
      };
    });
  }

  private buildScene(textures: THREE.CanvasTexture[]) {
    const positions = this.scatterPositions(this.CARD_COUNT);

    for (let i = 0; i < this.CARD_COUNT; i++) {
      const tex = textures[i % textures.length];
      const aspect = 1 / 1.25;
      const scale = 1.5 + Math.random() * 0.9;
      const geo = new THREE.PlaneGeometry(scale * aspect, scale);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
      const mesh = new THREE.Mesh(geo, mat);

      const p = positions[i];
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotation.z = (Math.random() - 0.5) * 0.3;

      const motion: CardMotion = {
        baseX: p.x, baseY: p.y, baseZ: p.z,
        speed: 0.12 + Math.random() * 0.28,
        phase: Math.random() * Math.PI * 2,
        driftX: (Math.random() - 0.5) * 0.7,
        driftZ: (Math.random() - 0.5) * 0.5,
        spinSpeed: (Math.random() - 0.5) * 0.15,
      };
      mesh.userData = motion;

      this.group.add(mesh);
      this.cards.push(mesh);
    }
    this.scene.add(this.group);

    const pCount = 350;
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 36;
      pPos[i * 3 + 1] = (Math.random() - 0.5) * 24;
      pPos[i * 3 + 2] = (Math.random() - 0.5) * 26 - 4;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({ color: 0xe0245e, size: 0.035, transparent: true, opacity: 0.5 });
    this.particles = new THREE.Points(pGeo, pMat);
    this.scene.add(this.particles);
  }

  private animate = () => {
    if (this.disposed) return;
    this.animationFrameId = requestAnimationFrame(this.animate);
    const t = this.clock.getElapsedTime();

    this.curX += (this.targetX - this.curX) * 0.04;
    this.curY += (this.targetY - this.curY) * 0.04;

    this.camera.position.x = this.curX * 4.5;
    this.camera.position.y = -this.curY * 3;
    this.camera.lookAt(0, 0, -4);

    this.group.rotation.y = this.curX * 0.1;
    this.group.rotation.x = this.curY * 0.06;

    this.cards.forEach(m => {
      const d = m.userData as CardMotion;
      m.position.y = d.baseY + Math.sin(t * d.speed + d.phase) * 0.6;
      m.position.x = d.baseX + Math.sin(t * d.speed * 0.6 + d.phase) * d.driftX;
      m.position.z = d.baseZ + Math.cos(t * d.speed * 0.5 + d.phase) * d.driftZ;
      m.lookAt(this.camera.position);
      m.rotation.z += d.spinSpeed * 0.003;
    });

    if (this.particles) {
      this.particles.rotation.y = t * 0.008;
    }

    this.renderer!.render(this.scene, this.camera);
  };

  openLoginModal() {
    this.errorMsg.set(null);
    this.showLoginModal.set(true);
  }

  closeLoginModal() {
    this.showLoginModal.set(false);
    this.errorMsg.set(null);
  }

  async login() {
    try {
      this.errorMsg.set(null);
      await this.supabaseService.signInWithGoogle();
    } catch (err: any) {
      this.errorMsg.set(err.message || 'Có lỗi xảy ra khi kết nối tới Google OAuth.');
    }
  }
}
