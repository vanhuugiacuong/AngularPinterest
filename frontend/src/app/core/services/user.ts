import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private baseUrl = 'http://localhost:3000/api/users';

  async getUserProfile(username: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/${encodeURIComponent(username)}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Failed to fetch user profile: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Error fetching profile for user ${username}:`, error);
      throw error;
    }
  }

  async toggleFollow(id: string, token: string): Promise<{ followed: boolean }> {
    try {
      const response = await fetch(`${this.baseUrl}/${id}/follow`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to toggle follow: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Error toggling follow for user ${id}:`, error);
      throw error;
    }
  }

  async updateProfile(updates: { username?: string; bio?: string }, token: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.message || `Failed to update profile: ${response.statusText}`);
    }
    return await response.json();
  }

  async uploadAvatar(file: File, token: string): Promise<any> {
    const formData = new FormData();
    formData.append('avatar', file);
    const response = await fetch(`${this.baseUrl}/me/avatar`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.message || `Failed to upload avatar: ${response.statusText}`);
    }
    return await response.json();
  }
}
