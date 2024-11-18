import { HttpClient } from '@angular/common/http';
import { Component } from '@angular/core';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss'
})
export class AdminComponent {
  roomUsers: any[] = [];

  constructor(private http: HttpClient) {
    this.getRoomUsers('room1'); // Replace 'room1' with the actual room name if needed
  }

  getRoomUsers(room: string) {
    this.http.get(`/roomUsers`).subscribe((response: any) => {
      this.roomUsers = response;
    });
  }

}
