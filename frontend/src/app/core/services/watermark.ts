import { Injectable, inject, signal } from '@angular/core';
import { API_BASE_URL } from '../api-base';
import { SupabaseService } from './supabase';

export type WatermarkType = 'TEXT' | 'LOGO';
export type WatermarkPosition =
  | 'TOP_LEFT' | 'TOP_CENTER' | 'TOP_RIGHT'
  | 'MIDDLE_LEFT' | 'MIDDLE_CENTER' | 'MIDDLE_RIGHT'
  | 'BOTTOM_LEFT' | 'BOTTOM_CENTER' | 'BOTTOM_RIGHT';

export interface WatermarkPreset {
  id: string;
  userId: string;
  name: string;
  type: WatermarkType;
  text: string | null;
  logoStoragePath: string | null;
  position: WatermarkPosition;
  opacity: number;
  scale: number;
  margin: number;
  rotation: number;
  tiled: boolean;
  spacing: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WatermarkPresetForm {
  name: string;
  type: WatermarkType;
  text?: string;
  position?: WatermarkPosition;
  opacity?: number;
  scale?: number;
  margin?: number;
  rotation?: number;
  tiled?: boolean;
  spacing?: number;
  isDefault?: boolean;
  logo?: File;
}

function toFormData(form: WatermarkPresetForm): FormData {
  const data = new FormData();
  data.append('name', form.name);
  data.append('type', form.type);
  if (form.text !== undefined) data.append('text', form.text);
  if (form.position !== undefined) data.append('position', form.position);
  if (form.opacity !== undefined) data.append('opacity', String(form.opacity));
  if (form.scale !== undefined) data.append('scale', String(form.scale));
  if (form.margin !== undefined) data.append('margin', String(form.margin));
  if (form.rotation !== undefined) data.append('rotation', String(form.rotation));
  if (form.tiled !== undefined) data.append('tiled', String(form.tiled));
  if (form.spacing !== undefined) data.append('spacing', String(form.spacing));
  if (form.isDefault !== undefined) data.append('isDefault', String(form.isDefault));
  if (form.logo) data.append('logo', form.logo);
  return data;
}

@Injectable({ providedIn: 'root' })
export class WatermarkService {
  private auth = inject(SupabaseService);
  presets = signal<WatermarkPreset[]>([]);
  loading = signal(false);

  private async authHeaders(): Promise<HeadersInit> {
    const token = await this.auth.getSessionToken();
    return { Authorization: `Bearer ${token}` };
  }

  async list(): Promise<WatermarkPreset[]> {
    this.loading.set(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/memberships/watermark-presets`, {
        headers: await this.authHeaders(),
      });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data.message || 'Không tải được danh sách watermark.');
      this.presets.set(data);
      return data;
    } finally {
      this.loading.set(false);
    }
  }

  async create(form: WatermarkPresetForm): Promise<WatermarkPreset> {
    const response = await fetch(`${API_BASE_URL}/api/memberships/watermark-presets`, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: toFormData(form),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Không thể tạo cấu hình watermark.');
    await this.list();
    return data;
  }

  async update(id: string, form: WatermarkPresetForm): Promise<WatermarkPreset> {
    const response = await fetch(`${API_BASE_URL}/api/memberships/watermark-presets/${id}`, {
      method: 'PUT',
      headers: await this.authHeaders(),
      body: toFormData(form),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Không thể cập nhật cấu hình watermark.');
    await this.list();
    return data;
  }

  async remove(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/memberships/watermark-presets/${id}`, {
      method: 'DELETE',
      headers: await this.authHeaders(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'Không thể xoá cấu hình watermark.');
    }
    await this.list();
  }

  async preview(pinId: string, form: WatermarkPresetForm): Promise<string> {
    const response = await fetch(`${API_BASE_URL}/api/memberships/watermark-presets/preview/${pinId}`, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: toFormData(form),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'Không thể tạo bản xem trước.');
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }
}
