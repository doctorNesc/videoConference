import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Router, RouterModule } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterModule, CommonModule, FormsModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent {

  roomName: string = '';
  inTheRoom: boolean = false;
  userName: string = '';
  constructor(private router: Router) { }

  // Redirect to the entered room
  joinConference() {
    if (this.roomName.trim()) {
      this.router.navigate([`/sfu/${this.roomName.trim()}`], { queryParams: { userName: this.userName, inTheRoom: this.inTheRoom } });
    } else {
      alert('Please enter a room name!');
    }
  }

  // Generate a random 8-character room name and navigate to it
  createNewConference() {
    const generatedRoomName = this.generateRoomName();
    this.router.navigate([`/sfu/${generatedRoomName}`], { queryParams: { userName: this.userName, inTheRoom: true } });
  }

  // Helper function to generate an 8-character random room name
  private generateRoomName(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let roomName = '';
    for (let i = 0; i < 8; i++) {
      roomName += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return roomName;
  }

}
