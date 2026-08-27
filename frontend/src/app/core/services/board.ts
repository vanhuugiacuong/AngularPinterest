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
  private baseUrl = 'http://localhost:3000/api/boards';

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

  async getGroupBoards(token: string): Promise<Board[]> {
    try {
      const response = await fetch(`${this.baseUrl}/group`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch group boards: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching group boards in BoardService:', error);
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

  async updateBoard(
    boardId: string,
    updates: { name?: string; description?: string; isSecret?: boolean },
    token: string
  ): Promise<Board> {
    const response = await fetch(`${this.baseUrl}/${boardId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.message || `Failed to update board: ${response.statusText}`);
    }
    return await response.json();
  }

  async deleteBoard(boardId: string, token: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${boardId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.message || `Failed to delete board: ${response.statusText}`);
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

  async toggleFavoritePin(boardId: string, pinId: string, token: string): Promise<{ isFavorite: boolean }> {
    const response = await fetch(`${this.baseUrl}/${boardId}/pins/${pinId}/favorite`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.message || `Failed to toggle favorite: ${response.statusText}`);
    }
    return await response.json();
  }

  async reorderPins(boardId: string, pinIds: string[], token: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${boardId}/pins/order`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ pinIds })
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.message || `Failed to reorder pins: ${response.statusText}`);
    }
  }

  async addCollaborator(boardId: string, username: string, token: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/${boardId}/collaborators`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username })
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.message || `Failed to add collaborator: ${response.statusText}`);
    }
    return await response.json();
  }

  async removeCollaborator(boardId: string, userId: string, token: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${boardId}/collaborators/${userId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.message || `Failed to remove collaborator: ${response.statusText}`);
    }
  }
}
