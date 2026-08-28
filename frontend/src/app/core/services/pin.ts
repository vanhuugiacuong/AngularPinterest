import { Injectable } from '@angular/core';

export interface Pin {
  id: string;
  title: string;
  description?: string;
  /** Bản công khai nhỏ, KHÔNG watermark — dùng ngoài feed/lưới ảnh. */
  imageUrl: string;
  /**
   * Ảnh Premium: bản lớn hơn CÓ watermark phủ kín, dùng ở trang chi tiết.
   * null với ảnh thường (khi đó chi tiết hiện luôn imageUrl).
   */
  previewUrl?: string | null;
  sourceUrl?: string;
  userId: string;
  createdAt: string;
  isAiGenerated: boolean;
  isPremium?: boolean;
  isCollage?: boolean;
  user: {
    id: string;
    username: string;
    avatarUrl?: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class PinService {
  private baseUrl = 'http://localhost:3000/api/pins';

  async getPins(page = 1, limit = 20, token?: string, seed?: string): Promise<Pin[]> {
    try {
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      let url = `${this.baseUrl}?page=${page}&limit=${limit}`;
      if (seed) {
        url += `&seed=${seed}`;
      }
      const response = await fetch(url, {
        headers
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch pins: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching pins in PinService:', error);
      throw error;
    }
  }

  async getRelatedPins(id: string, page = 1, limit = 20): Promise<Pin[]> {
    try {
      const response = await fetch(`${this.baseUrl}/${id}/related?page=${page}&limit=${limit}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch related pins: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Error fetching related pins for ${id}:`, error);
      throw error;
    }
  }

  async getPinById(id: string): Promise<Pin> {
    try {
      const response = await fetch(`${this.baseUrl}/${id}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch pin details: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Error fetching pin ${id}:`, error);
      throw error;
    }
  }

  async deletePin(id: string, token: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to delete pin: ${response.statusText}`);
      }
    } catch (error) {
      console.error(`Error deleting pin ${id}:`, error);
      throw error;
    }
  }

  async toggleLike(id: string, token: string): Promise<{ liked: boolean }> {
    try {
      const response = await fetch(`${this.baseUrl}/${id}/like`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to toggle like: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Error toggling like for pin ${id}:`, error);
      throw error;
    }
  }

  async addComment(id: string, content: string, token: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/${id}/comment`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content })
      });
      if (!response.ok) {
        throw new Error(`Failed to add comment: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Error adding comment to pin ${id}:`, error);
      throw error;
    }
  }

  async hidePin(id: string, token: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${id}/hide`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(await this.errorMessage(response, 'Không thể ẩn ảnh này.'));
    }
  }

  async reportPin(id: string, token: string, reason?: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${id}/report`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason }),
    });
    if (!response.ok) {
      throw new Error(await this.errorMessage(response, 'Không thể gửi báo cáo.'));
    }
  }

  async markInterest(id: string, token: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${id}/interest`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(await this.errorMessage(response, 'Không thể ghi nhận yêu cầu.'));
    }
  }

  async createUploadPin(formData: FormData, token: string): Promise<any> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      if (!response.ok) {
        throw new Error(await this.errorMessage(response, `Failed to upload pin: ${response.statusText}`));
      }
      return await response.json();
    } catch (error) {
      console.error('Error uploading pin in PinService:', error);
      throw error;
    }
  }

  async searchByImage(formData: FormData): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/search-by-image`, {
        method: 'POST',
        body: formData
      });
      if (!response.ok) {
        throw new Error(await this.errorMessage(response, 'Không thể tìm kiếm bằng hình ảnh.'));
      }
      return await response.json();
    } catch (error) {
      console.error('Error searching by image in PinService:', error);
      throw error;
    }
  }

  /** Crop / "Pinterest Lens" search: match against a region of an existing pin. box = 0..1 fractions. */
  async searchByRegion(
    pinId: string,
    box: { x: number; y: number; width: number; height: number },
    signal?: AbortSignal,
  ): Promise<any[]> {
    const response = await fetch(`${this.baseUrl}/${pinId}/search-by-region`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ box }),
      signal,
    });
    if (!response.ok) {
      throw new Error(await this.errorMessage(response, 'Không thể tìm kiếm theo vùng ảnh.'));
    }
    return await response.json();
  }

  async saveAiPin(body: any, token: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/ai-save`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        throw new Error(await this.errorMessage(response, `Failed to save AI pin: ${response.statusText}`));
      }
      return await response.json();
    } catch (error) {
      console.error('Error saving AI pin in PinService:', error);
      throw error;
    }
  }

  private async errorMessage(response: Response, fallback: string): Promise<string> {
    try {
      const body = await response.json();
      return body.message || fallback;
    } catch {
      return fallback;
    }
  }
}
