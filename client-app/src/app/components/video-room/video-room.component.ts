import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { MediasoupService } from '../../services/mediasoup.service';

@Component({
  selector: 'app-video-room',
  standalone: true,
  imports: [],
  templateUrl: './video-room.component.html',
  styleUrl: './video-room.component.scss'
})

export class VideoRoomComponent implements OnInit {

  @ViewChild("localVideo") localVideo!: ElementRef;

  constructor(private mediasoupService: MediasoupService) { }

  ngOnInit(): void {
    console.log(navigator.mediaDevices.enumerateDevices());

    // Initialize mediasoup logic on component load
  }

}
