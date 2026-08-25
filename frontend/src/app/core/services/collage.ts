import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class CollageService {
  private baseUrl = 'http://localhost:3000/api/collage';

  // Sends an image to the backend, which asks the AI cutout service to isolate
  // the main subject and strip the background. Returns a transparent-background PNG.
  async cutoutObject(file: File, token: string): Promise<Blob> {
    const formData = new FormData();
    formData.append('image', file);

    const response = await fetch(`${this.baseUrl}/cutout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Cắt vật thể thất bại: ${response.statusText}`);
    }

    return await response.blob();
  }
}
