import { Injectable } from '@angular/core';
import { ReportReason } from './messaging';
import { API_BASE_URL } from '../api-base';
import { safeFetch } from '../utils/http-error';

@Injectable({ providedIn: 'root' })
export class SafetyService {
  private readonly baseUrl = `${API_BASE_URL}/api/users`;

  async blockUser(id: string, token: string): Promise<{ blocked: boolean }> {
    return this.request(`${this.baseUrl}/${id}/block`, token, { method: 'POST' });
  }

  async unblockUser(id: string, token: string): Promise<{ blocked: boolean }> {
    return this.request(`${this.baseUrl}/${id}/block`, token, { method: 'DELETE' });
  }

  async reportUser(
    id: string,
    reason: ReportReason,
    details: string | undefined,
    token: string,
  ): Promise<{ id: string }> {
    return this.request(`${this.baseUrl}/${id}/report`, token, {
      method: 'POST',
      body: JSON.stringify({ reason, details }),
    });
  }

  private async request<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (init.body) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await safeFetch(url, { ...init, headers });
    if (!response.ok) {
      let message = `Yêu cầu thất bại (${response.status})`;
      try {
        const body = await response.json();
        message = body.message || message;
      } catch {
        // Keep the status-based message when the server does not return JSON.
      }
      throw new Error(message);
    }
    return response.json() as Promise<T>;
  }
}
