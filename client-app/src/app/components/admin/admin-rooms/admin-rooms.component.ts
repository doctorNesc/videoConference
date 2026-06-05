import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { RoomConfig } from '../../../utils/hybrid-types';

@Component({
  selector: 'app-admin-rooms',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-rooms.component.html',
  styleUrl: './admin-rooms.component.scss',
})
export class AdminRoomsComponent implements OnInit {
  rooms: RoomConfig[] = [];
  loading = true;
  loadError: string | null = null;
  newRoomName = '';
  showNewRoomForm = false;
  creatingRoom = false;
  createError: string | null = null;

  constructor(
    private http: HttpClient,
    private router: Router
  ) {}

  ngOnInit() {
    this.loadRooms();
  }

  
  private async loadRooms() {
    try {
      const response = await this.http
        .get<RoomConfig[]>('/api/rooms')
        .toPromise();
      this.rooms = response || [];
    } catch (err) {
      console.error('[AdminRooms] Failed to load rooms:', err);
      this.loadError = `Failed to load rooms: ${err}`;
    } finally {
      this.loading = false;
    }
  }

  
  toggleNewRoomForm() {
    this.showNewRoomForm = !this.showNewRoomForm;
    this.newRoomName = '';
    this.createError = null;
  }

  async createNewRoom() {
    if (!this.newRoomName.trim()) {
      this.createError = 'Room name is required';
      return;
    }

    this.creatingRoom = true;
    this.createError = null;

    try {
      const newRoom: RoomConfig = {
        roomName: this.newRoomName.trim(),
        splatPath: '',
        displays: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await this.http.post('/api/rooms', newRoom).toPromise();

      
      await this.loadRooms();
      this.showNewRoomForm = false;
      this.newRoomName = '';
    } catch (err) {
      console.error('[AdminRooms] Failed to create room:', err);
      this.createError = `Failed to create room: ${err}`;
    } finally {
      this.creatingRoom = false;
    }
  }

  
  editRoom(roomName: string) {
    this.router.navigate(['/admin/room', roomName]);
  }

  
  async deleteRoom(roomName: string) {
    if (!confirm(`Are you sure you want to delete room "${roomName}"?`)) {
      return;
    }

    try {
      await this.http.delete(`/api/rooms/${roomName}`).toPromise();
      await this.loadRooms();
    } catch (err) {
      console.error('[AdminRooms] Failed to delete room:', err);
      alert(`Failed to delete room: ${err}`);
    }
  }

  
  async uploadSplat(roomName: string, event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('splat', file);

    try {
      await this.http
        .post(`/api/rooms/${roomName}/splat`, formData)
        .toPromise();
      alert('Splat file uploaded successfully!');
      await this.loadRooms();
    } catch (err) {
      console.error('[AdminRooms] Failed to upload splat:', err);
      alert(`Failed to upload splat: ${err}`);
    }
  }

  
  formatDate(dateStr: string): string {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  }
}
