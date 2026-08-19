import { Injectable } from '@angular/core';

export interface Board {
  id: string;
  name: string;
  description?: string;
  isSecret: boolean;
  userId: string;
  createdAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class BoardService {
  private baseUrl = 'http://localhost:3001/api/boards';

  async getBoards(token: string): Promise<Board[]> {
    try {
      const response = await fetch(this.baseUrl, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch boards: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching boards in BoardService:', error);
      throw error;
    }
  }

  async getBoardById(id: string, token: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/${id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch board details: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Error fetching board ${id}:`, error);
      throw error;
    }
  }

  async createBoard(name: string, description: string, isSecret: boolean, token: string): Promise<Board> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, description, isSecret })
      });
      if (!response.ok) {
        throw new Error(`Failed to create board: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error creating board:', error);
      throw error;
    }
  }

  async addPinToBoard(boardId: string, pinId: string, token: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/${boardId}/pins`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ pinId })
      });
      if (!response.ok) {
        throw new Error(`Failed to add pin to board: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Error adding pin ${pinId} to board ${boardId}:`, error);
      throw error;
    }
  }

  async removePinFromBoard(boardId: string, pinId: string, token: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/${boardId}/pins/${pinId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to remove pin from board: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Error removing pin ${pinId} from board ${boardId}:`, error);
      throw error;
    }
  }
}
