import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class RoomDataService {

  constructor(private http: HttpClient) {}

  getRoomUsers(room: string): Observable<any[]> {
    return this.http.get<any[]>(`/api/roomUsers?room=${room}`);
  }

  getAllUsers():Observable<any[]>  {
    return this.http.get<any[]>('/api/roomUsers');
  }
}
