import { Injectable } from '@angular/core';

export interface Pin {
  id: string;
  title: string;
  description?: string;
  imageUrl: string;
  sourceUrl?: string;
  userId: string;
  createdAt: string;
  isAiGenerated: boolean;
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
        throw new Error(`Failed to upload pin: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error uploading pin in PinService:', error);
      throw error;
    }
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
        throw new Error(`Failed to save AI pin: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error saving AI pin in PinService:', error);
      throw error;
    }
  }
}
