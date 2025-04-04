import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class RoomDataService {

  constructor(private http: HttpClient) {}
  private socket!: Socket;
  private serverUrl = 'http://localhost:3000';  // Your server URL

  getRoomUsers(room: string): Observable<any[]> {
    return this.http.get<any[]>(`/api/roomUsers?room=${room}`);
  }

  getAllUsers():Observable<any[]>  {
    return this.http.get<any[]>('/api/roomUsers');
  }
}
