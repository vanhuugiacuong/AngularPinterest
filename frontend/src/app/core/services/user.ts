import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private baseUrl = 'http://localhost:3001/api/users';

  async getUserProfile(username: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/${encodeURIComponent(username)}`);
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
}
