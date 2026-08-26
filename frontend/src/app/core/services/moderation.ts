import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ModerationService {
  private baseUrl = 'http://localhost:3000/api/moderation';

  /** Throws with the backend's message if the image is blocked. Resolves silently if safe. */
  async checkImage(file: File, token: string): Promise<void> {
    const formData = new FormData();
    formData.append('image', file);
    const response = await fetch(`${this.baseUrl}/check-image`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });
    if (!response.ok) {
      throw new Error(await this.errorMessage(response, 'Ảnh không hợp lệ.'));
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
