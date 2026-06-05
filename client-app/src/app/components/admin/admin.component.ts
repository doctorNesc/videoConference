import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { interval, Subscription, switchMap, startWith } from 'rxjs';
import { RoomDataService } from '../../services/room-data.service';
import { RoomTopologyDTO } from '../../utils/hybrid-types';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
})
export class AdminComponent implements OnInit, OnDestroy {
  allRooms: any[] = [];
  topologies: RoomTopologyDTO[] = [];

  private subs = new Subscription();

  constructor(
    private roomService: RoomDataService,
    private http: HttpClient,
  ) {}

  ngOnInit(): void {
    
    this.subs.add(
      interval(5000).pipe(startWith(0), switchMap(() => this.roomService.getAllUsers())).subscribe({
        next: (data) => { this.allRooms = data; },
        error: (err) => console.error('Failed to fetch rooms:', err),
      })
    );

    
    this.subs.add(
      interval(5000).pipe(
        startWith(0),
        switchMap(() => this.http.get<RoomTopologyDTO[]>('/api/topology')),
      ).subscribe({
        next: (data) => { this.topologies = data; },
        error: (err) => console.error('Failed to fetch topology:', err),
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  /** Returns the topology for a given room name */
  topologyFor(roomName: string): RoomTopologyDTO | undefined {
    return this.topologies.find(t => t.roomName === roomName);
  }

  refresh() {
    this.roomService.getAllUsers().subscribe(data => { this.allRooms = data; });
    this.http.get<RoomTopologyDTO[]>('/api/topology').subscribe(data => { this.topologies = data; });
  }
}
