import { Injectable } from '@angular/core';
import { API_BASE_URL } from '../api-base';
import { safeFetch } from '../utils/http-error';

export interface Board {
  id: string;
  name: string;
  description?: string;
  isSecret: boolean;
  userId: string;
  createdAt: string;
  pinCount?: number;
  coverImageUrl?: string | null;
  thumbnails?: Array<{
    id: string;
    title: string;
    imageUrl: string;
    isAiGenerated: boolean;
  }>;
}

@Injectable({
  providedIn: 'root',
})
export class BoardService {
  private baseUrl = `${API_BASE_URL}/api/boards`;

  private async request<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (init.body) headers.set('Content-Type', 'application/json');
    const response = await safeFetch(url, { ...init, headers });
    if (!response.ok) {
      let message = `Yêu cầu thất bại (${response.status})`;
      try {
        const body = await response.json();
        message = body.message || message;
      } catch {
        // Giữ message theo status nếu server không trả JSON.
      }
      throw new Error(message);
    }
    return response.json() as Promise<T>;
  }

  getBoards(token: string): Promise<Board[]> {
    return this.request<Board[]>(this.baseUrl, token);
  }

  getBoardById(id: string, token: string): Promise<Board & { boardPins?: Array<{ pin: unknown }> }> {
    return this.request(`${this.baseUrl}/${id}`, token);
  }

  createBoard(name: string, description: string, isSecret: boolean, token: string): Promise<Board> {
    return this.request<Board>(this.baseUrl, token, {
      method: 'POST',
      body: JSON.stringify({ name, description, isSecret }),
    });
  }

  updateBoard(
    id: string,
    updates: Partial<Pick<Board, 'name' | 'description' | 'isSecret'>>,
    token: string,
  ): Promise<Board> {
    return this.request<Board>(`${this.baseUrl}/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  deleteBoard(id: string, token: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`${this.baseUrl}/${id}`, token, { method: 'DELETE' });
  }

  addPinToBoard(boardId: string, pinId: string, token: string): Promise<unknown> {
    return this.request(`${this.baseUrl}/${boardId}/pins`, token, {
      method: 'POST',
      body: JSON.stringify({ pinId }),
    });
  }

  removePinFromBoard(boardId: string, pinId: string, token: string): Promise<unknown> {
    return this.request(`${this.baseUrl}/${boardId}/pins/${pinId}`, token, { method: 'DELETE' });
  }
}
