import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-video-options',
  standalone: true,
  imports: [],
  templateUrl: './video-options.component.html',
  styleUrl: './video-options.component.scss',
})
export class VideoOptionsComponent {
  @Input() roomName!: string;

  @Input() videoEnabled = true;
  @Input() audioEnabled = true;

  @Output() videoToggle = new EventEmitter<boolean>();
  @Output() audioToggle = new EventEmitter<boolean>();
  @Output() showUsersPanel = new EventEmitter<boolean>();

  toggleVideo() {
    this.videoEnabled = !this.videoEnabled;
    this.videoToggle.emit(this.videoEnabled);
  }

  toggleAudio() {
    this.audioEnabled = !this.audioEnabled;
    this.audioToggle.emit(this.audioEnabled);
  }

  camera = true;
}
