import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { RoomDataService } from 'src/app/services/room-data.service';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
})
export class AdminComponent implements OnInit {
  allRooms: any[] = [];
  constructor(private roomService: RoomDataService) {}

  ngOnInit(): void {
    this.roomService.getAllUsers().subscribe({
      next: (data) => {
        this.allRooms = data;
      },
      error: (err) => console.error('Failed to fetch rooms:', err),
      complete: ()=>console.log('complete')
    });
  }
}
