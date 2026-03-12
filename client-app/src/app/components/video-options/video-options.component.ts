import { Component, EventEmitter, Input, Output, signal, } from '@angular/core';
import { CommonModule } from '@angular/common';

import { Observable } from 'rxjs';

@Component({
  selector: 'app-video-options',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './video-options.component.html',
  styleUrl: './video-options.component.scss',
})
export class VideoOptionsComponent {
  @Input() roomName!: string;

  @Input() videoEnabled = true;
  @Input() audioEnabled = true;
  // @Input() isSharingScreen$!: Observable<boolean>;
  @Output() startScreenShare = new EventEmitter<void>();
  @Output() stopScreenShare = new EventEmitter<void>();
  @Output() leaveCall = new EventEmitter<void>();

  @Output() videoToggle = new EventEmitter<boolean>();
  @Output() audioToggle = new EventEmitter<boolean>();
  @Output() showUsersPanel = new EventEmitter<boolean>();

  isSharingScreen = signal(false);

  toggleVideo() {
    this.videoEnabled = !this.videoEnabled;
    this.videoToggle.emit(this.videoEnabled);
  }

  toggleAudio() {
    this.audioEnabled = !this.audioEnabled;
    this.audioToggle.emit(this.audioEnabled);
  }

  startScreenShareBtn() {
    this.isSharingScreen.update(() => true);
    this.startScreenShare.emit();
  }

  stopScreenShareBtn() {
    this.isSharingScreen.update(() => false);
    this.stopScreenShare.emit();
  }
}
